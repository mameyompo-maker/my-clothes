import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();

// 課金まわり(Stripe)は billing.ts に分離している。ここから再輸出することで
// firebase deploy の対象に含める。
export { createBillingPortalSession, createCheckoutSession, stripeWebhook } from "./billing.js";

const geminiApiKey = defineSecret("GEMINI_API_KEY");

// クライアント側 (src/lib/functions.ts の CALLABLE_REGION) と必ず同じ値にすること。
// 食い違うと callable がどこにも存在しないエンドポイントを叩き、AI合成が無言で全滅する。
// 実際に一度それで壊れた: クライアントが asia-northeast1、関数が us-central1 だった。
const FUNCTION_REGION = "us-central1";

// 2026-08時点でのNano Banana系モデル(画像編集対応)。Kaz指定により標準グレードの
// gemini-3.1-flash-imageをデフォルトにしている。コストを抑えたい場合は functions/.env で
// GEMINI_IMAGE_MODEL を "gemini-3.1-flash-lite-image"(安価)に、画質を上げたい場合は
// "gemini-3-pro-image"(高品質・高コスト)に上書きする。モデル名は変更されやすいので、
// デプロイ前に https://ai.google.dev/gemini-api/docs/models で最新の識別子を必ず確認すること。
// 無料枠はなく、Google Cloud側の課金設定が必要。
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

interface ClosetItemDoc {
  imageUrl: string;
}

interface FacePatternDoc {
  imageUrl: string;
  ownerUid?: string;
}

// ---------- 合成キャッシュ ----------
// 同じ「顔 × 服の組み合わせ × 本人プロフィール × モデル」なら結果を使い回す。
// 目的は2つ: (1) 先行合成(precomposeOutfit)と投稿後の合成(composeOutfitImage)が
// 同じ組み合わせを二重にGeminiへ投げないようにする (2) 取り消して作り直した場合や
// 同じコーデをまた着る場合に、待ち時間ゼロ・トークン消費ゼロで返す。

interface ComposedCacheDoc {
  status: "pending" | "ready" | "failed";
  url: string | null;
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
}

/** pending がこの時間を超えて放置されていたら、前の呼び出しが死んだとみなして引き取る。 */
const PENDING_STALE_MS = 150_000;

/**
 * 1日あたりの新規Gemini呼び出し回数の上限(キャッシュヒットは消費しない)。
 * 先行合成は投稿前でも呼べるため、「2択は1日1回」の制限だけでは合成回数を縛れない。
 * 1枚約10円なので、この上限が1日あたりの最大コスト(約200円/人)になる。
 */
const DAILY_COMPOSE_LIMIT = 20;

function jstDateString(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * キャッシュキー。アイテムは画像URLで見る(IDではなく)ので、同じ写真の組み合わせなら
 * 何度作り直しても同じキーになる。プロフィール(personalHint)とモデル名も混ぜてあり、
 * 身長や骨格を変えた・モデルを切り替えた場合は自然に別キー=作り直しになる。
 */
function cacheKeyFor(uid: string, itemImageUrls: string[], faceImageUrl: string, personalHint: string): string {
  const payload = [GEMINI_IMAGE_MODEL, uid, faceImageUrl, ...[...itemImageUrls].sort(), personalHint].join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

/** 1日の合成回数を1消費する。上限に達していたら resource-exhausted を投げる。 */
async function acquireComposeSlot(uid: string): Promise<void> {
  const ref = db.collection("composeQuota").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const today = jstDateString();
    const data = snap.exists ? (snap.data() as { date?: string; count?: number }) : null;
    const count = data?.date === today ? (data.count ?? 0) : 0;
    if (count >= DAILY_COMPOSE_LIMIT) {
      throw new HttpsError("resource-exhausted", "今日のAI合成の回数上限に達しました。明日また使えます。");
    }
    tx.set(ref, { date: today, count: count + 1 });
  });
}

/**
 * キャッシュを見てから合成する本体。全ての合成はここを通すこと。
 *
 * - ready ならそのURLを即返す(Gemini呼び出しなし)
 * - 誰かが pending 中なら終わるのを待って結果をもらう(二重合成の防止)
 * - どちらでもなければ自分が pending を立てて合成する
 */
async function composeCached(
  uid: string,
  itemImageUrls: string[],
  faceImageUrl: string,
  personalHint: string
): Promise<string> {
  const key = cacheKeyFor(uid, itemImageUrls, faceImageUrl, personalHint);
  const ref = db.collection("composedCache").doc(key);

  const first = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as ComposedCacheDoc) : null;
    if (data?.status === "ready" && data.url) return { mode: "ready" as const, url: data.url };
    if (data?.status === "pending" && Date.now() - data.updatedAt < PENDING_STALE_MS) {
      return { mode: "wait" as const, url: null };
    }
    tx.set(ref, {
      status: "pending",
      url: null,
      ownerUid: uid,
      createdAt: data?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return { mode: "compose" as const, url: null };
  });

  if (first.mode === "ready" && first.url) return first.url;

  if (first.mode === "wait") {
    // 同じ組み合わせを別の呼び出し(たいてい先行合成)が処理中。待って結果をもらう。
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await sleep(2500);
      const snap = await ref.get();
      const data = snap.exists ? (snap.data() as ComposedCacheDoc) : null;
      if (data?.status === "ready" && data.url) return data.url;
      if (data?.status === "failed") break;
      if (data?.status === "pending" && Date.now() - data.updatedAt >= PENDING_STALE_MS) break;
    }
    // 待っていた相手が失敗した・止まっている。自分で引き取って合成する。
    await ref.set({ status: "pending", ownerUid: uid, updatedAt: Date.now() }, { merge: true });
  }

  try {
    await acquireComposeSlot(uid);
    const url = await composeWithGemini(itemImageUrls, faceImageUrl, uid, key, personalHint);
    await ref.set({ status: "ready", url, ownerUid: uid, updatedAt: Date.now() }, { merge: true });
    return url;
  } catch (err) {
    await ref.set({ status: "failed", url: null, ownerUid: uid, updatedAt: Date.now() }, { merge: true });
    throw err;
  }
}

interface OutfitCandidateDoc {
  itemIds: string[];
  facePatternId: string | null;
  liveCaptureUrl: string | null;
  composedImageUrl: string | null;
  composeStatus: "pending" | "ready" | "failed";
}

interface OutfitPostDoc {
  ownerUid: string;
  candidates: OutfitCandidateDoc[];
}

/** 合成の指示を本人に寄せるために読むプロフィール項目。すべて任意。 */
interface UserProfileDoc {
  height?: number | null;
  bodyType?: "straight" | "wave" | "natural" | "unknown";
  personalColor?: string;
  sizeTops?: string;
  sizeBottoms?: string;
  favoriteGenres?: string[];
}

/**
 * 骨格タイプごとの、写真に落とすときの見え方の指示。
 *
 * 骨格診断は「似合う服」を選ぶための考え方だが、ここでやりたいのは**選定ではなく再現**。
 * 本人が選んだ服はそのまま着せたうえで、シルエットの出方だけを本人の体型に寄せる。
 * 診断結果に合わない服を勝手に差し替えたり、体型を補正して痩せさせたりはしない
 * (自分の姿を確認するための機能なので、事実と違う姿を返すと役に立たない)。
 */
const BODY_TYPE_HINTS: Record<string, string> = {
  straight:
    "上半身に厚みがありメリハリのある体型です。トップスは体の線を拾いすぎず、すっきりと落ちるように見せてください。",
  wave:
    "上半身が薄く、下重心の華奢な体型です。トップスはやわらかく、ウエスト位置が高く見えるように配置してください。",
  natural:
    "骨格がしっかりしてフレーム感のある体型です。肩や関節の存在感を活かし、ゆったりしたシルエットで見せてください。",
  unknown: "",
};

const PERSONAL_COLOR_HINTS: Record<string, string> = {
  spring: "肌はイエローベースで明るく、blushのある血色感で描いてください。",
  summer: "肌はブルーベースで柔らかく、青みのある涼しげな血色感で描いてください。",
  autumn: "肌はイエローベースで深みがあり、落ち着いた血色感で描いてください。",
  winter: "肌はブルーベースでくっきりとし、コントラストのある印象で描いてください。",
};

/**
 * 本人の情報から、合成時の追加指示を組み立てる。
 * 未設定の項目は黙って飛ばす。埋まっていない前提で書くこと。
 */
function buildPersonalHint(profile: UserProfileDoc | null): string {
  if (!profile) return "";
  const lines: string[] = [];

  if (typeof profile.height === "number" && profile.height > 0) {
    lines.push(`身長は約${profile.height}cmです。頭身のバランスをこれに合わせてください。`);
  }

  const bodyHint = profile.bodyType ? BODY_TYPE_HINTS[profile.bodyType] : "";
  if (bodyHint) lines.push(bodyHint);

  const colorHint = profile.personalColor ? PERSONAL_COLOR_HINTS[profile.personalColor] : "";
  if (colorHint) lines.push(colorHint);

  const sizes = [profile.sizeTops, profile.sizeBottoms].filter(Boolean);
  if (sizes.length > 0) {
    lines.push(`普段のサイズは ${sizes.join(" / ")} です。服の余り具合をこれに近づけてください。`);
  }

  if (lines.length === 0) return "";
  return (
    "\n\n【この人物について】\n" +
    lines.join("\n") +
    "\nただし、**写っている顔と服は絶対に変えないでください。**体型を細く補正したり、" +
    "似合う別の服に差し替えたりせず、あくまで本人が選んだ服を本人が着た姿として描いてください。"
  );
}

// ---------- composeOutfitImage ----------
// クローゼット写真+顔写真を Gemini の画像編集モデルに渡し、1枚の合成画像を生成する。
// (友達招待はCloud Functions不要のfirestore.rulesだけで完結するため、この関数のみが
// Blazeプラン+Gemini課金を必要とする。無料枠だけで試したい間はデプロイしなくてよい。
// composeOutfitImageの呼び出しはクライアント側でPromise.allSettledに包まれており、
// 失敗しても投稿自体は成立し、UIは合成前の服の写真をそのまま並べて表示する。)

// region は必ずクライアント側 (src/lib/functions.ts の getFunctions(app, ...)) と一致させること。
// 一致していないと callable の呼び出しが存在しないエンドポイントに飛び、AI合成が丸ごと無言で失敗する。
export const composeOutfitImage = onCall<{ postId: string; candidateIndex: number }>(
  {
    region: FUNCTION_REGION,
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
    // ⚠ **2026-08-05 に判明した、AI合成が動かなかったもうひとつの原因。**
    // この関数だけ Cloud Run の invoker 権限が空になっており、呼び出しが
    // 「The request was not authenticated」で弾かれて**関数本体に到達していなかった**。
    // callable は Firebase SDK が独自ヘッダで認証情報を運ぶので、Cloud Run から見ると
    // 常に「未認証」に見える。そのため invoker は public にしたうえで、
    // **関数の中で `request.auth` を必ず確認する**のが Firebase の標準構成
    // (下の handler 冒頭で unauthenticated を投げている)。
    // 既定値まかせにすると同じことが再発するので、明示的に書いて固定する。
    invoker: "public",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    const { postId, candidateIndex } = request.data;
    const postRef = db.collection("outfitPosts").doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません。");

    const post = postSnap.data() as OutfitPostDoc;
    if (post.ownerUid !== uid) throw new HttpsError("permission-denied", "自分の投稿だけ合成できます。");

    const candidate = post.candidates[candidateIndex];
    if (!candidate) throw new HttpsError("invalid-argument", "候補が見つかりません。");

    try {
      const itemDocs = await Promise.all(
        candidate.itemIds.map((id) => db.collection("closetItems").doc(id).get())
      );
      const itemImageUrls = itemDocs
        .filter((d) => d.exists)
        .map((d) => (d.data() as ClosetItemDoc).imageUrl);

      let faceImageUrl = candidate.liveCaptureUrl;
      if (!faceImageUrl && candidate.facePatternId) {
        const faceSnap = await db.collection("facePatterns").doc(candidate.facePatternId).get();
        faceImageUrl = faceSnap.exists ? (faceSnap.data() as FacePatternDoc).imageUrl : null;
      }
      if (!faceImageUrl) throw new Error("顔写真が見つかりませんでした。");

      // 本人のプロフィールを合成の指示に混ぜる。無くても合成は成立するので、
      // 読めなかった場合は黙って諦める(合成そのものを失敗させない)。
      let profile: UserProfileDoc | null = null;
      try {
        const userSnap = await db.collection("users").doc(uid).get();
        if (userSnap.exists) profile = userSnap.data() as UserProfileDoc;
      } catch {
        profile = null;
      }

      const composedImageUrl = await composeCached(uid, itemImageUrls, faceImageUrl, buildPersonalHint(profile));
      await patchCandidate(postRef, candidateIndex, { composedImageUrl, composeStatus: "ready" });
      return { composedImageUrl };
    } catch (err) {
      await patchCandidate(postRef, candidateIndex, { composedImageUrl: null, composeStatus: "failed" });
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err instanceof Error ? err.message : "画像合成に失敗しました。");
    }
  }
);

// ---------- precomposeOutfit(先行合成) ----------
// 投稿を作る前に、服+顔の組み合わせだけで合成を始めるための呼び出し。
// コーデ作成の「仕上げ」ステップに入った時点でクライアントが叩き、本人が気分や
// 共有相手を入力している裏で合成を済ませておく。結果はキャッシュに載るので、
// 投稿確定時の composeOutfitImage はキャッシュヒットして即座に返る。
export const precomposeOutfit = onCall<{
  itemIds: string[];
  facePatternId: string | null;
  liveCaptureUrl: string | null;
}>(
  {
    region: FUNCTION_REGION,
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
    // composeOutfitImage と同じ理由で明示する(そちらのコメント参照)。
    // 今は付いているが、既定値まかせだと片方だけ落ちる事故が実際に起きた。
    invoker: "public",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    const { itemIds, facePatternId, liveCaptureUrl } = request.data;
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 10 || itemIds.some((x) => typeof x !== "string")) {
      throw new HttpsError("invalid-argument", "アイテムの指定が不正です。");
    }

    const itemDocs = await Promise.all(itemIds.map((id) => db.collection("closetItems").doc(id).get()));
    const itemImageUrls = itemDocs.filter((d) => d.exists).map((d) => (d.data() as ClosetItemDoc).imageUrl);
    if (itemImageUrls.length === 0) throw new HttpsError("invalid-argument", "アイテムが見つかりません。");

    let faceImageUrl: string | null = null;
    if (typeof liveCaptureUrl === "string" && liveCaptureUrl) {
      // 自分のアップロード領域(outfits/{uid}/)のURL以外は受け付けない。
      // ここを検証しないと、任意のURLの画像で他人になりすました合成ができてしまう。
      if (!liveCaptureUrl.startsWith("https://") || !decodeURIComponent(liveCaptureUrl).includes(`/outfits/${uid}/`)) {
        throw new HttpsError("permission-denied", "顔写真のURLが不正です。");
      }
      faceImageUrl = liveCaptureUrl;
    } else if (typeof facePatternId === "string" && facePatternId) {
      const faceSnap = await db.collection("facePatterns").doc(facePatternId).get();
      const face = faceSnap.exists ? (faceSnap.data() as FacePatternDoc) : null;
      if (!face || face.ownerUid !== uid) {
        throw new HttpsError("permission-denied", "自分の顔パターンだけ使えます。");
      }
      faceImageUrl = face.imageUrl;
    }
    if (!faceImageUrl) throw new HttpsError("invalid-argument", "顔写真がありません。");

    let profile: UserProfileDoc | null = null;
    try {
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.exists) profile = userSnap.data() as UserProfileDoc;
    } catch {
      profile = null;
    }

    const composedImageUrl = await composeCached(uid, itemImageUrls, faceImageUrl, buildPersonalHint(profile));
    return { composedImageUrl };
  }
);

async function patchCandidate(
  postRef: DocumentReference,
  index: number,
  patch: Partial<OutfitCandidateDoc>
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    const data = snap.data() as OutfitPostDoc;
    const candidates = [...data.candidates];
    candidates[index] = { ...candidates[index], ...patch };
    tx.update(postRef, { candidates });
  });
}

/**
 * 見本の服の画像を置いてある公開サイトのオリジン。
 *
 * ⚠ **2026-08-05 に判明した「AI合成が一度も成功していなかった」原因のひとつ。**
 * 見本の服は Next.js の `public/seed/` にあり、Firestore には
 * `/seed/women/xxx.png` という**相対パス**で入っている。ブラウザはそのまま表示できるが、
 * **サーバー(Cloud Functions)の `fetch` は絶対URLしか受け付けない**ため、
 * `TypeError: Failed to parse URL` で即死していた。
 * 実データを数えたところ closetItems 77件が**すべて**この形式だったので、
 * 事実上あらゆるコーデで合成が失敗していた。
 *
 * 自分で撮った服は Storage の絶対URLになるので、そちらは元から問題ない。
 */
const PUBLIC_ASSET_ORIGIN =
  process.env.PUBLIC_ASSET_ORIGIN || "https://my-clothes-three.vercel.app";

/** 相対パスなら公開サイトのオリジンを補う。絶対URLはそのまま返す。 */
function absoluteImageUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return PUBLIC_ASSET_ORIGIN.replace(/\/$/, "") + (url.startsWith("/") ? url : `/${url}`);
}

async function fetchAsBase64(url: string): Promise<{ mimeType: string; data: string }> {
  const res = await fetch(absoluteImageUrl(url));
  if (!res.ok) throw new Error(`画像の取得に失敗しました: ${url}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buffer.toString("base64") };
}

async function composeWithGemini(
  itemImageUrls: string[],
  faceImageUrl: string,
  ownerUid: string,
  cacheKey: string,
  personalHint = ""
): Promise<string> {
  const images = await Promise.all([faceImageUrl, ...itemImageUrls].map(fetchAsBase64));

  const parts: Record<string, unknown>[] = [
    {
      text:
        "1枚目は人物の顔写真です。この人物の顔・髪型・雰囲気を保ったまま、2枚目以降に写っている服・靴・" +
        "アクセサリーを実際に着用している様子を、自然な光でシンプルな背景の写真として1枚に合成してください。" +
        "全身または上半身が分かる構図でお願いします。" +
        personalHint,
    },
    ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${geminiApiKey.value()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        // "TEXT"も含めないとAPIが受け付けないため、画像だけ欲しくても両方指定する。
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API呼び出しに失敗しました (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const inlinePart = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!inlinePart?.inlineData?.data) {
    throw new Error("Geminiから画像が返されませんでした。");
  }

  const buffer = Buffer.from(inlinePart.inlineData.data, "base64");
  const bucket = getStorage().bucket();
  // キャッシュキーをそのままファイル名にする。同じ組み合わせは同じパスに落ち、
  // 投稿とは独立に(取り消し・作り直しをまたいで)使い回せる。
  const path = `composed/${ownerUid}/${cacheKey}.png`;
  const file = bucket.file(path);
  await file.save(buffer, { contentType: inlinePart.inlineData.mimeType ?? "image/png" });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

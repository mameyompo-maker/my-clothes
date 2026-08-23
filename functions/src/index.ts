import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";

initializeApp();
const db = getFirestore();

// 課金まわり(Stripe)は billing.ts に分離している。ここから再輸出することで
// firebase deploy の対象に含める。
export { createBillingPortalSession, createCheckoutSession, stripeWebhook } from "./billing.js";

// ⚠ 2026-08-05 方針変更: **AI合成は各利用者が自分の Google AI Studio APIキーで行う。**
// 以前は運営(Kazさん)の GEMINI_API_KEY をシークレットに置き、全員ぶんの費用を
// 運営が負担していた。今はプロフィールから各自が登録したキーを userSecrets/{uid} から
// 読んで使う。運営側のキーは一切使わない。
//
// userSecrets はルール上「本人しか読めない」コレクションで、ここでは Admin SDK が
// ルールを迂回して読む。users ドキュメントに置くと他の利用者全員に読まれるので絶対に置かない。
interface UserSecretDoc {
  /** 歴史的な名前。中身は Google のキーとは限らないので provider と合わせて見ること。 */
  geminiApiKey?: string;
  provider?: AiProvider;
}

/**
 * 対応しているAIの提供元。
 *
 * 2026-08-22 に Google 専用から2社対応へ広げた(Kazさん依頼:「Googleやその他のAIの
 * APIキーを自分で入れて使えるように」)。利用者に提供元を選ばせるのではなく、
 * **キーの形から機械的に判別する**。「どっちを選ぶか」を尋ねても、貼る本人にとっては
 * 自明(取ってきた場所がそのまま答え)なので、選択肢を出すだけ手間が増える。
 */
export type AiProvider = "google" | "openai";

/** キーの見た目から提供元を割り出す。判別できなければ null。 */
function detectProvider(apiKey: string): AiProvider | null {
  const key = apiKey.trim();
  if (key.startsWith("AIza")) return "google";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

interface AiCredential {
  apiKey: string;
  provider: AiProvider;
}

/** その提供元で使う画像モデル名。キャッシュキーにも混ぜる。 */
function modelFor(provider: AiProvider): string {
  return provider === "openai" ? OPENAI_IMAGE_MODEL : GEMINI_IMAGE_MODEL;
}

/** 本人が登録したAPIキー。未登録なら分かりやすい理由で失敗させる。 */
async function requireUserAiKey(uid: string): Promise<AiCredential> {
  const snap = await db.collection("userSecrets").doc(uid).get();
  const data = snap.exists ? (snap.data() as UserSecretDoc) : null;
  const apiKey = data?.geminiApiKey?.trim();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "AI合成にはご自身のAPIキーが必要です。プロフィール編集画面から登録してください。"
    );
  }
  // 保存時に provider を書いているが、それ以前に登録された分は入っていない。
  // その場合はキーの形から割り出し、判別できなければ Google 扱い(旧仕様のまま)にする。
  const provider = data?.provider ?? detectProvider(apiKey) ?? "google";
  return { apiKey, provider };
}

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

// OpenAI 側の画像モデル。2026-04-21 公開の gpt-image-2 が現行で、images/edits に
// 複数枚の入力画像を渡せる(顔+服を1回で渡せるということ)。モデル名は変わりやすいので、
// 変更前に https://developers.openai.com/api/docs/models で最新の識別子を確認すること。
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

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

// 以前あった1日あたりの合成回数上限(DAILY_COMPOSE_LIMIT)は撤去した。
// あれは運営のキーを全員で使っていたときに、運営の請求額を抑えるための制限だった。
// 各自が自分のキーで叩く今は、費用も上限も本人の Google 側の設定に属するため、
// アプリが勝手に回数を絞る理由がない。無駄打ちの防止は下のキャッシュが担う。

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * キャッシュキー。アイテムは画像URLで見る(IDではなく)ので、同じ写真の組み合わせなら
 * 何度作り直しても同じキーになる。プロフィール(personalHint)とモデル名も混ぜてあり、
 * 身長や骨格を変えた・モデルを切り替えた場合は自然に別キー=作り直しになる。
 */
function cacheKeyFor(
  uid: string,
  itemImageUrls: string[],
  faceImageUrl: string,
  personalHint: string,
  provider: AiProvider
): string {
  // モデル名を混ぜてあるので、提供元を乗り換えた人は自然に別キー=作り直しになる。
  const payload = [modelFor(provider), uid, faceImageUrl, ...[...itemImageUrls].sort(), personalHint].join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
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
  personalHint: string,
  cred: AiCredential
): Promise<string> {
  const key = cacheKeyFor(uid, itemImageUrls, faceImageUrl, personalHint, cred.provider);
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
    const url = await composeWithAi(itemImageUrls, faceImageUrl, uid, key, personalHint, cred);
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

      const cred = await requireUserAiKey(uid);
      const composedImageUrl = await composeCached(
        uid,
        itemImageUrls,
        faceImageUrl,
        buildPersonalHint(profile),
        cred
      );
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

    const cred = await requireUserAiKey(uid);
    const composedImageUrl = await composeCached(
      uid,
      itemImageUrls,
      faceImageUrl,
      buildPersonalHint(profile),
      cred
    );
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

// ---------- 合成本体 ----------
//
// 提供元が Google でも OpenAI でも、やることは同じ「顔1枚 + 服数枚 → 着用姿1枚」。
// 違うのはHTTPの叩き方だけなので、指示文と保存はここで共通化し、
// generateWith* だけを提供元ごとに分けている。

const COMPOSE_INSTRUCTION =
  "1枚目は人物の顔写真です。この人物の顔・髪型・雰囲気を保ったまま、2枚目以降に写っている服・靴・" +
  "アクセサリーを実際に着用している様子を、自然な光でシンプルな背景の写真として1枚に合成してください。" +
  "全身または上半身が分かる構図でお願いします。";

interface GeneratedImage {
  /** base64(データURLの接頭辞は含まない) */
  data: string;
  mimeType: string;
}

async function composeWithAi(
  itemImageUrls: string[],
  faceImageUrl: string,
  ownerUid: string,
  cacheKey: string,
  personalHint: string,
  cred: AiCredential
): Promise<string> {
  // 顔を必ず先頭にする。OpenAI は「1枚目が主たる編集対象」という扱いなので順番に意味がある。
  const images = await Promise.all([faceImageUrl, ...itemImageUrls].map(fetchAsBase64));
  const instruction = COMPOSE_INSTRUCTION + personalHint;

  const generated =
    cred.provider === "openai"
      ? await generateWithOpenAI(images, instruction, cred.apiKey)
      : await generateWithGemini(images, instruction, cred.apiKey);

  return saveComposedImage(generated, ownerUid, cacheKey);
}

async function generateWithGemini(
  images: GeneratedImage[],
  instruction: string,
  apiKey: string
): Promise<GeneratedImage> {
  const parts: Record<string, unknown>[] = [
    { text: instruction },
    ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
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
  return {
    data: inlinePart.inlineData.data,
    mimeType: inlinePart.inlineData.mimeType ?? "image/png",
  };
}

/**
 * OpenAI の images/edits。複数枚を `image[]` として multipart で送る
 * (2026-08 時点で最大16枚。顔1 + 服数枚なので余裕がある)。
 * 返りは常に base64 で `data[0].b64_json` に入る。
 */
async function generateWithOpenAI(
  images: GeneratedImage[],
  instruction: string,
  apiKey: string
): Promise<GeneratedImage> {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", instruction);
  images.forEach((img, i) => {
    const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
    const ext = img.mimeType.includes("png") ? "png" : "jpg";
    form.append("image[]", new Blob([bytes], { type: img.mimeType }), `${i}.${ext}`);
  });

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`OpenAI API呼び出しに失敗しました (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAIから画像が返されませんでした。");
  return { data: b64, mimeType: "image/png" };
}

/** 生成結果を Storage に置いて公開URLを返す。提供元によらず共通。 */
async function saveComposedImage(
  generated: GeneratedImage,
  ownerUid: string,
  cacheKey: string
): Promise<string> {
  const buffer = Buffer.from(generated.data, "base64");
  const bucket = getStorage().bucket();
  // キャッシュキーをそのままファイル名にする。同じ組み合わせは同じパスに落ち、
  // 投稿とは独立に(取り消し・作り直しをまたいで)使い回せる。
  const path = `composed/${ownerUid}/${cacheKey}.png`;
  const file = bucket.file(path);
  await file.save(buffer, { contentType: generated.mimeType });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

// ---------- verifyAiKey ----------
// 登録したキーがちゃんと使えるかを確かめる。
//
// ブラウザから直接叩いて確かめる手もあるが、その場合 CORS の可否に結果が左右されるうえ、
// キーをクライアントに読み戻す必要が出る。ここはサーバー側で保存済みのキーを使って確認し、
// **キーの中身をクライアントへ返さない**。
//
// 実際に1枚生成すると本人に課金が発生してしまうので、確認は「モデルが引けるか」までに
// とどめている(キーの有効性と権限はこれで分かる)。
export const verifyAiKey = onCall(
  {
    region: FUNCTION_REGION,
    timeoutSeconds: 30,
    // composeOutfitImage と同じ理由(callable は Firebase SDK 側で認証を運ぶ)。
    invoker: "public",
  },
  async (request): Promise<{ ok: boolean; message: string; provider?: AiProvider }> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    let cred: AiCredential;
    try {
      cred = await requireUserAiKey(uid);
    } catch {
      return { ok: false, message: "APIキーが登録されていません。" };
    }

    try {
      return cred.provider === "openai"
        ? { ...(await verifyOpenAIKey(cred.apiKey)), provider: cred.provider }
        : { ...(await verifyGoogleKey(cred.apiKey)), provider: cred.provider };
    } catch {
      return { ok: false, message: "接続できませんでした。時間をおいてお試しください。" };
    }
  }
);

async function verifyGoogleKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}?key=${apiKey}`
  );
  if (res.ok) return { ok: true, message: "APIキーを確認しました。AI合成が使えます。" };

  const body = await res.text();
  if (res.status === 400 && body.includes("API_KEY_INVALID")) {
    return { ok: false, message: "APIキーが正しくありません。もう一度コピーし直してください。" };
  }
  if (res.status === 403) {
    return {
      ok: false,
      message: "このキーでは Gemini API を利用できません。Google AI Studio で有効になっているか確認してください。",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      message: `画像生成モデル(${GEMINI_IMAGE_MODEL})にアクセスできません。キーに紐づくプロジェクトを確認してください。`,
    };
  }
  return { ok: false, message: `確認できませんでした(HTTP ${res.status})。` };
}

async function verifyOpenAIKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`https://api.openai.com/v1/models/${OPENAI_IMAGE_MODEL}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) return { ok: true, message: "APIキーを確認しました。AI合成が使えます。" };

  if (res.status === 401) {
    return { ok: false, message: "APIキーが正しくありません。もう一度コピーし直してください。" };
  }
  if (res.status === 403) {
    return {
      ok: false,
      message: "このキーでは画像生成を利用できません。OpenAI の権限設定を確認してください。",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      message: `画像生成モデル(${OPENAI_IMAGE_MODEL})を利用できません。支払い方法の登録が済んでいるか確認してください。`,
    };
  }
  return { ok: false, message: `確認できませんでした(HTTP ${res.status})。` };
}

// ---------- suggestOutfitPair(Claudeに2択のコーデを考えてもらう) ----------
//
// 2026-08-23 追加(Kazさん依頼)。**Claudeは画像を作れない**ので、AI合成とは役割が違う。
// ここでやるのは「クローゼットの中から今日の2択の組み合わせを考える」ところまでで、
// 出来上がった組み合わせを絵にするのは従来どおり Gemini / OpenAI の担当。
//
// キーは userSecrets/{uid}.anthropicApiKey に別フィールドで持つ。画像生成用の
// geminiApiKey とは用途が違うので、同じ欄に混ぜない(混ぜると、Claudeのキーを
// 貼った人の合成が必ず失敗する)。

/** 判断の質がそのまま提案の質になるので、既定は最上位モデル。 */
const STYLIST_MODEL = process.env.ANTHROPIC_STYLIST_MODEL || "claude-opus-5";

interface StylistSecretDoc {
  anthropicApiKey?: string;
}

async function requireStylistKey(uid: string): Promise<string> {
  const snap = await db.collection("userSecrets").doc(uid).get();
  const key = snap.exists ? (snap.data() as StylistSecretDoc).anthropicApiKey?.trim() : undefined;
  if (!key) {
    throw new HttpsError(
      "failed-precondition",
      "コーデの提案には Anthropic のAPIキーが必要です。プロフィール編集画面から登録してください。"
    );
  }
  return key;
}

interface ClosetItemFull {
  id: string;
  category: string;
  label: string;
  brand?: string;
  color?: string;
  genres?: string[];
  seasons?: string[];
  lastWornAt?: number | null;
}

/**
 * 返してほしい形。**配列の要素数は指定できない**(JSON Schema の minItems/maxItems は
 * 構造化出力では未対応)ので、「ちょうど2案」は指示文の側で伝える。
 */
const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemIds: { type: "array", items: { type: "string" } },
          label: { type: "string" },
          reason: { type: "string" },
        },
        required: ["itemIds", "label", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

interface SuggestedCandidate {
  itemIds: string[];
  label: string;
  reason: string;
}

/** 今の季節。提案の前提になるので必ず渡す。 */
function currentSeasonLabel(): string {
  const month = new Date().getMonth() + 1;
  if (month <= 2 || month === 12) return "冬";
  if (month <= 5) return "春";
  if (month <= 8) return "夏";
  return "秋";
}

function describeCloset(items: ClosetItemFull[]): string {
  return items
    .map((it) => {
      const parts = [`id=${it.id}`, `種類=${it.category}`, `名前=${it.label}`];
      if (it.color) parts.push(`色=${it.color}`);
      if (it.brand) parts.push(`ブランド=${it.brand}`);
      if (it.genres?.length) parts.push(`ジャンル=${it.genres.join("/")}`);
      if (it.seasons?.length) parts.push(`季節=${it.seasons.join("/")}`);
      if (it.lastWornAt) {
        const days = Math.floor((Date.now() - it.lastWornAt) / 86_400_000);
        parts.push(`最後に着てから${days}日`);
      }
      return `- ${parts.join(" / ")}`;
    })
    .join("\n");
}

function describeProfile(profile: UserProfileDoc | null): string {
  if (!profile) return "(登録なし)";
  const lines: string[] = [];
  if (typeof profile.height === "number" && profile.height > 0) lines.push(`身長 約${profile.height}cm`);
  if (profile.bodyType && profile.bodyType !== "unknown") lines.push(`骨格タイプ ${profile.bodyType}`);
  if (profile.personalColor && profile.personalColor !== "unknown") {
    lines.push(`パーソナルカラー ${profile.personalColor}`);
  }
  if (profile.favoriteGenres?.length) lines.push(`好きなジャンル ${profile.favoriteGenres.join("/")}`);
  return lines.length > 0 ? lines.join(" / ") : "(登録なし)";
}

export const suggestOutfitPair = onCall(
  {
    region: FUNCTION_REGION,
    timeoutSeconds: 120,
    // 他の callable と同じ理由(認証は Firebase SDK 側が運ぶ)。
    invoker: "public",
  },
  async (request): Promise<{ candidates: SuggestedCandidate[] }> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    const apiKey = await requireStylistKey(uid);

    const [itemsSnap, userSnap] = await Promise.all([
      db.collection("closetItems").where("ownerUid", "==", uid).limit(80).get(),
      db.collection("users").doc(uid).get(),
    ]);

    const items: ClosetItemFull[] = itemsSnap.docs.map((d) => {
      const data = d.data() as Partial<ClosetItemFull>;
      return {
        id: d.id,
        category: data.category ?? "tops",
        label: data.label ?? "服",
        brand: data.brand,
        color: data.color,
        genres: data.genres,
        seasons: data.seasons,
        lastWornAt: data.lastWornAt ?? null,
      };
    });
    if (items.length < 2) {
      throw new HttpsError("failed-precondition", "クローゼットの服が少なすぎます。何着か登録してから試してください。");
    }
    const profile = userSnap.exists ? (userSnap.data() as UserProfileDoc) : null;

    const prompt = [
      "あなたは相手の手持ちの服だけでコーデを組むスタイリストです。",
      "",
      `# 今の季節\n${currentSeasonLabel()}`,
      "",
      `# 本人のプロフィール\n${describeProfile(profile)}`,
      "",
      `# 手持ちの服(この中からしか選べません)\n${describeCloset(items)}`,
      "",
      "# お願い",
      "今日の「どっちにしよう」を決めるための2択を作ってください。**ちょうど2案**です。",
      "",
      "守ってほしいこと:",
      "- itemIds には、上のリストにある id をそのまま使ってください。リストに無い id は絶対に作らないでください。",
      "- 1案につきトップスとボトムスは必ず1点ずつ入れてください(ワンピースがある場合はそれ1点でも構いません)。",
      "  アウター・靴・小物は、季節と全体のまとまりを見て必要なら足してください。",
      "- 2案は**はっきり違う方向性**にしてください。色だけ違う似た組み合わせは2択の意味がありません。",
      "- label は10文字程度でその日の気分が分かる名前(例:きれいめ通学、ゆるっと休日)。",
      "- reason は40〜80文字で、なぜその組み合わせなのかを本人に語りかける調子で。",
      "  難しい専門用語は使わず、迷っている人の背中を押す一言にしてください。",
    ].join("\n");

    let message;
    try {
      const client = new Anthropic({ apiKey });
      message = await client.messages.create({
        model: STYLIST_MODEL,
        max_tokens: 16000,
        // 服選びは長考する種類の仕事ではない。thinking を切るより effort を下げるほうが
        // 安全(切ると出力にタグが混ざることがある)。
        output_config: { effort: "low", format: { type: "json_schema", schema: SUGGESTION_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) throw new HttpsError("failed-precondition", "Anthropic のAPIキーが正しくありません。");
      if (status === 429) throw new HttpsError("resource-exhausted", "利用が集中しています。少し時間をおいてお試しください。");
      throw new HttpsError("internal", err instanceof Error ? err.message : "コーデの提案に失敗しました。");
    }

    // 断られた場合は content が空か途中までになる。先頭を無条件に読まない。
    if (message.stop_reason === "refusal") {
      throw new HttpsError("internal", "この内容には回答できませんでした。");
    }
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new HttpsError("internal", "提案を受け取れませんでした。");
    }

    let parsed: { candidates?: SuggestedCandidate[] };
    try {
      parsed = JSON.parse(textBlock.text) as { candidates?: SuggestedCandidate[] };
    } catch {
      throw new HttpsError("internal", "提案の形式が読み取れませんでした。もう一度お試しください。");
    }

    // 存在しない服のidが混ざっていたら落とす。画面側はidを信じて描画するので、
    // ここを通さないと「選んだはずの服が出てこない」不具合になる。
    const known = new Set(items.map((it) => it.id));
    const candidates = (parsed.candidates ?? [])
      .map((c) => ({
        itemIds: (c.itemIds ?? []).filter((id) => known.has(id)),
        label: (c.label ?? "").slice(0, 20),
        reason: (c.reason ?? "").slice(0, 200),
      }))
      .filter((c) => c.itemIds.length > 0)
      .slice(0, 2);

    if (candidates.length < 2) {
      throw new HttpsError("internal", "2案そろいませんでした。もう一度お試しください。");
    }
    return { candidates };
  }
);

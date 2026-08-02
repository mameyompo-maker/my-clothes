import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const db = getFirestore();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

// 2026-08時点でのNano Banana系モデル(画像編集対応)。安いlite版をデフォルトにしている。
// 画質を上げたい場合は functions/.env で GEMINI_IMAGE_MODEL を
// "gemini-3.1-flash-image"(標準)や "gemini-3-pro-image"(高品質・高コスト)に上書きする。
// モデル名は変更されやすいので、デプロイ前に https://ai.google.dev/gemini-api/docs/models で
// 最新の識別子を必ず確認すること。無料枠はなく、Google Cloud側の課金設定が必要。
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";

interface ClosetItemDoc {
  imageUrl: string;
}

interface FacePatternDoc {
  imageUrl: string;
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

// ---------- redeemInviteCode ----------
// 招待コードを使った友達追加は、双方のユーザードキュメントを書き換える必要があるため
// クライアントの Firestore ルールでは許可せず、Admin SDK 権限を持つこの関数経由で行う。

export const redeemInviteCode = onCall<{ code: string }>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

  const code = (request.data.code ?? "").trim().toUpperCase();
  if (!code) throw new HttpsError("invalid-argument", "招待コードを入力してください。");

  const snap = await db.collection("users").where("inviteCode", "==", code).limit(1).get();
  if (snap.empty) throw new HttpsError("not-found", "その招待コードは見つかりませんでした。");

  const friendDoc = snap.docs[0];
  const friendUid = friendDoc.id;
  if (friendUid === uid) throw new HttpsError("failed-precondition", "自分自身は追加できません。");

  const batch = db.batch();
  batch.update(db.collection("users").doc(uid), { friendUids: FieldValue.arrayUnion(friendUid) });
  batch.update(db.collection("users").doc(friendUid), { friendUids: FieldValue.arrayUnion(uid) });
  await batch.commit();

  return { friendUid, friendName: (friendDoc.data().name as string | undefined) ?? "友達" };
});

// ---------- composeOutfitImage ----------
// クローゼット写真+顔写真を Gemini の画像編集モデルに渡し、1枚の合成画像を生成する。

export const composeOutfitImage = onCall<{ postId: string; candidateIndex: number }>(
  { secrets: [geminiApiKey], timeoutSeconds: 120, memory: "512MiB" },
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

      const composedImageUrl = await composeWithGemini(itemImageUrls, faceImageUrl, uid, postId, candidateIndex);
      await patchCandidate(postRef, candidateIndex, { composedImageUrl, composeStatus: "ready" });
      return { composedImageUrl };
    } catch (err) {
      await patchCandidate(postRef, candidateIndex, { composedImageUrl: null, composeStatus: "failed" });
      throw new HttpsError("internal", err instanceof Error ? err.message : "画像合成に失敗しました。");
    }
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

async function fetchAsBase64(url: string): Promise<{ mimeType: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像の取得に失敗しました: ${url}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, data: buffer.toString("base64") };
}

async function composeWithGemini(
  itemImageUrls: string[],
  faceImageUrl: string,
  ownerUid: string,
  postId: string,
  candidateIndex: number
): Promise<string> {
  const images = await Promise.all([faceImageUrl, ...itemImageUrls].map(fetchAsBase64));

  const parts: Record<string, unknown>[] = [
    {
      text:
        "1枚目は人物の顔写真です。この人物の顔・髪型・雰囲気を保ったまま、2枚目以降に写っている服・靴・" +
        "アクセサリーを実際に着用している様子を、自然な光でシンプルな背景の写真として1枚に合成してください。" +
        "全身または上半身が分かる構図でお願いします。",
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
  const path = `composed/${ownerUid}/${postId}_${candidateIndex}.png`;
  const file = bucket.file(path);
  await file.save(buffer, { contentType: inlinePart.inlineData.mimeType ?? "image/png" });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

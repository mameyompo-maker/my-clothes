import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

// functions/src/index.ts の FUNCTION_REGION と必ず同じ値にすること。
// ここが asia-northeast1、関数側が us-central1 になっていたせいで、
// AI合成の呼び出しが存在しないエンドポイントに飛んで全て失敗していた。
const CALLABLE_REGION = "us-central1";

function functions() {
  if (!app) throw new Error("Firebaseが未設定です。.env.local を確認してください。");
  return getFunctions(app, CALLABLE_REGION);
}

// 友達招待(redeemInviteCode)はCloud Functions不要のFirestoreルールだけで完結するように
// なったため、lib/firestore.ts 側に移した。ここにはBlazeプラン前提の機能だけを置く。

export interface ComposeOutfitImageInput {
  postId: string;
  candidateIndex: number;
}

export interface ComposeOutfitImageResult {
  composedImageUrl: string;
}

/**
 * Calls the `composeOutfitImage` Cloud Function, which reads the candidate's item + face
 * photos, asks Gemini to render them as one outfit shot, and writes the result back onto
 * the post document (candidates[candidateIndex].composedImageUrl).
 */
export async function composeOutfitImage(input: ComposeOutfitImageInput): Promise<ComposeOutfitImageResult> {
  const call = httpsCallable<ComposeOutfitImageInput, ComposeOutfitImageResult>(functions(), "composeOutfitImage");
  const result = await call(input);
  return result.data;
}

export interface PrecomposeOutfitInput {
  itemIds: string[];
  facePatternId: string | null;
  liveCaptureUrl: string | null;
}

/**
 * 先行合成。投稿を作る前に「服+顔」の組み合わせだけで合成を始める。
 * コーデ作成の仕上げステップに入った時点で呼び、本人が気分や共有相手を入力している
 * 裏で合成を済ませる。結果はサーバー側のキャッシュに載るので、投稿確定時の
 * composeOutfitImage はキャッシュヒットしてほぼ即座に返る。
 */
export async function precomposeOutfit(input: PrecomposeOutfitInput): Promise<ComposeOutfitImageResult> {
  const call = httpsCallable<PrecomposeOutfitInput, ComposeOutfitImageResult>(functions(), "precomposeOutfit");
  const result = await call(input);
  return result.data;
}

/**
 * Stripe の決済ページのURLを受け取る。カード情報はこちらのアプリを一切通らず、
 * Stripe のホストするページで入力される。
 */
export async function createCheckoutSession(): Promise<string> {
  const call = httpsCallable<Record<string, never>, { url: string }>(functions(), "createCheckoutSession");
  const result = await call({});
  return result.data.url;
}

/** 解約・支払い方法の変更を行う Stripe カスタマーポータルのURL。 */
export async function createBillingPortalSession(): Promise<string> {
  const call = httpsCallable<Record<string, never>, { url: string }>(functions(), "createBillingPortalSession");
  const result = await call({});
  return result.data.url;
}

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import type { AiProvider } from "./aiProviders";

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

/**
 * AI合成の全体スイッチ(運営側の非常停止用)。
 *
 * 2026-08-05 以降、合成の費用は**利用者それぞれが自分の Google AI Studio APIキーで**負担する。
 * 運営のキーは使っていないので、運営に請求が来ることはない。したがって普段は true のままでよい。
 * 実際に合成が走るかどうかは「本人がキーを登録しているか」で決まる(下の hasKey 判定)。
 *
 * それでも止めたくなったとき用に、Vercel の環境変数
 * `NEXT_PUBLIC_AI_COMPOSE_ENABLED=false` で一括停止できる余地は残してある。
 * 止めても画面は壊れない。`OutfitCard` が `LookFigure`(AIを使わない全身コーデ表示)に
 * 落ちるようになっていて、そちらだけで十分に成立する作りにしてある。
 */
export const isAiComposeEnabled = process.env.NEXT_PUBLIC_AI_COMPOSE_ENABLED !== "false";

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
 * 登録済みのAPIキーが実際に使えるかをサーバー側で確認する。
 * キーの中身はクライアントに返さない(サーバーが保存済みの値を読んで叩くだけ)。
 */
export async function verifyAiKey(): Promise<{ ok: boolean; message: string; provider?: AiProvider }> {
  const call = httpsCallable<Record<string, never>, { ok: boolean; message: string; provider?: AiProvider }>(
    functions(),
    "verifyAiKey"
  );
  const result = await call({});
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

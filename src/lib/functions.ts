import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

function functions() {
  if (!app) throw new Error("Firebaseが未設定です。.env.local を確認してください。");
  return getFunctions(app, "asia-northeast1");
}

export interface RedeemInviteCodeResult {
  friendUid: string;
  friendName: string;
}

/** Calls the `redeemInviteCode` Cloud Function, which links two users as friends server-side. */
export async function redeemInviteCode(code: string): Promise<RedeemInviteCodeResult> {
  const call = httpsCallable<{ code: string }, RedeemInviteCodeResult>(functions(), "redeemInviteCode");
  const result = await call({ code });
  return result.data;
}

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

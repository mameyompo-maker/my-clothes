export type ClosetCategory =
  | "tops"
  | "bottoms"
  | "outerwear"
  | "shoes"
  | "accessories";

export const CLOSET_CATEGORIES: { value: ClosetCategory; label: string }[] = [
  { value: "tops", label: "トップス" },
  { value: "bottoms", label: "ボトムス" },
  { value: "outerwear", label: "アウター" },
  { value: "shoes", label: "シューズ" },
  { value: "accessories", label: "アクセサリー" },
];

export interface UserProfile {
  uid: string;
  name: string;
  avatarUrl: string | null;
  inviteCode: string;
  friendUids: string[];
  createdAt: number;
}

export interface ClosetItem {
  id: string;
  ownerUid: string;
  category: ClosetCategory;
  label: string;
  imageUrl: string;
  isSeed: boolean;
  createdAt: number;
}

export interface FacePattern {
  id: string;
  ownerUid: string;
  label: string;
  imageUrl: string;
  createdAt: number;
}

/** One candidate coordinate inside an outfit post. */
export interface OutfitCandidate {
  itemIds: string[];
  /** Either a saved face pattern id, or a freshly captured photo URL — never both. */
  facePatternId: string | null;
  liveCaptureUrl: string | null;
  composedImageUrl: string | null;
  composeStatus: "pending" | "ready" | "failed";
}

export interface OutfitPost {
  id: string;
  ownerUid: string;
  mood: string;
  note: string;
  candidates: OutfitCandidate[];
  sharedWithUids: string[];
  createdAt: number;
  /** Posts stop accepting votes and drop out of friends' feeds after this time. */
  expiresAt: number;
}

export interface Vote {
  id: string;
  postId: string;
  candidateIndex: number;
  voterUid: string;
  createdAt: number;
}

export interface VoteTally {
  candidateIndex: number;
  count: number;
}

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import type {
  ClosetCategory,
  ClosetItem,
  FacePattern,
  OutfitCandidate,
  OutfitPost,
  UserProfile,
  Vote,
} from "@/types/models";

const POST_LIFETIME_MS = 24 * 60 * 60 * 1000;

function requireDb() {
  if (!db) throw new Error("Firebaseが未設定です。.env.local を確認してください。");
  return db;
}

function requireStorage() {
  if (!storage) throw new Error("Firebaseが未設定です。.env.local を確認してください。");
  return storage;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ---------- Users ----------

export async function ensureUserProfile(uid: string, name: string, avatarUrl: string | null): Promise<UserProfile> {
  const database = requireDb();
  const ref_ = doc(database, "users", uid);
  const snap = await getDoc(ref_);
  if (snap.exists()) return snap.data() as UserProfile;

  const profile: UserProfile = {
    uid,
    name,
    avatarUrl,
    inviteCode: generateInviteCode(),
    friendUids: [],
    createdAt: Date.now(),
  };
  await setDoc(ref_, profile);
  return profile;
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function getFriendProfiles(friendUids: string[]): Promise<UserProfile[]> {
  if (friendUids.length === 0) return [];
  const profiles = await Promise.all(friendUids.map((uid) => getUserProfile(uid)));
  return profiles.filter((p): p is UserProfile => p !== null);
}

export interface RedeemInviteCodeResult {
  friendUid: string;
  friendName: string;
}

/**
 * 招待コードから相手を探し、双方の friendUids に相互登録する。Cloud Functions は使わず、
 * firestore.rules 側で「他人のドキュメントでも自分自身をfriendUidsに追加することだけ」を
 * 許可しているので、Blazeプラン(従量課金)なしの無料枠だけで完結する。
 */
export async function redeemInviteCode(myUid: string, rawCode: string): Promise<RedeemInviteCodeResult> {
  const database = requireDb();
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error("招待コードを入力してください。");

  const q = query(collection(database, "users"), where("inviteCode", "==", code), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("その招待コードは見つかりませんでした。");

  const friendDoc = snap.docs[0];
  const friendUid = friendDoc.id;
  if (friendUid === myUid) throw new Error("自分自身は追加できません。");

  await runTransaction(database, async (tx) => {
    const friendRef = doc(database, "users", friendUid);
    const friendSnap = await tx.get(friendRef);
    const friendData = friendSnap.data() as UserProfile;
    if (!friendData.friendUids.includes(myUid)) {
      tx.update(friendRef, { friendUids: [...friendData.friendUids, myUid] });
    }
    tx.update(doc(database, "users", myUid), { friendUids: arrayUnion(friendUid) });
  });

  return { friendUid, friendName: (friendDoc.data() as UserProfile).name ?? "友達" };
}

// ---------- Closet items ----------

export async function uploadImage(path: string, file: Blob): Promise<string> {
  const bucket = requireStorage();
  const storageRef = ref(bucket, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function addClosetItem(
  ownerUid: string,
  category: ClosetCategory,
  label: string,
  file: Blob
): Promise<ClosetItem> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const imageUrl = await uploadImage(`closet/${ownerUid}/${id}.jpg`, file);
  const item: ClosetItem = {
    id,
    ownerUid,
    category,
    label,
    imageUrl,
    isSeed: false,
    createdAt: Date.now(),
  };
  await setDoc(doc(database, "closetItems", id), item);
  return item;
}

export async function addSeedClosetItems(ownerUid: string, seedItems: { category: ClosetCategory; label: string; imageUrl: string }[]): Promise<void> {
  const database = requireDb();
  await Promise.all(
    seedItems.map((seed) => {
      const id = crypto.randomUUID();
      const item: ClosetItem = {
        id,
        ownerUid,
        category: seed.category,
        label: seed.label,
        imageUrl: seed.imageUrl,
        isSeed: true,
        createdAt: Date.now(),
      };
      return setDoc(doc(database, "closetItems", id), item);
    })
  );
}

export async function listClosetItems(ownerUid: string): Promise<ClosetItem[]> {
  const database = requireDb();
  const q = query(collection(database, "closetItems"), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ClosetItem).sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- Face patterns ----------

export async function addFacePattern(ownerUid: string, label: string, file: Blob): Promise<FacePattern> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const imageUrl = await uploadImage(`faces/${ownerUid}/${id}.jpg`, file);
  const pattern: FacePattern = { id, ownerUid, label, imageUrl, createdAt: Date.now() };
  await setDoc(doc(database, "facePatterns", id), pattern);
  return pattern;
}

export async function listFacePatterns(ownerUid: string): Promise<FacePattern[]> {
  const database = requireDb();
  const q = query(collection(database, "facePatterns"), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FacePattern).sort((a, b) => a.createdAt - b.createdAt);
}

export const MAX_FACE_PATTERNS = 5;

// ---------- Outfit posts ----------

export async function createOutfitPost(
  ownerUid: string,
  mood: string,
  note: string,
  candidates: OutfitCandidate[],
  sharedWithUids: string[]
): Promise<OutfitPost> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const post: OutfitPost = {
    id,
    ownerUid,
    mood,
    note,
    candidates,
    sharedWithUids,
    createdAt: now,
    expiresAt: now + POST_LIFETIME_MS,
  };
  await setDoc(doc(database, "outfitPosts", id), post);
  return post;
}

export async function getOutfitPost(postId: string): Promise<OutfitPost | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "outfitPosts", postId));
  return snap.exists() ? (snap.data() as OutfitPost) : null;
}

/** Posts shared with `myUid` that are still within their voting window, newest first. */
export function watchFeedPosts(myUid: string, onChange: (posts: OutfitPost[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts"), where("sharedWithUids", "array-contains", myUid));
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const posts = snap.docs
      .map((d) => d.data() as OutfitPost)
      .filter((p) => p.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt);
    onChange(posts);
  });
}

/** All of my own posts (active and expired), newest first — my personal outfit history. */
export function watchMyPosts(myUid: string, onChange: (posts: OutfitPost[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts"), where("ownerUid", "==", myUid), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as OutfitPost));
  });
}

// ---------- Votes ----------

export async function castVote(postId: string, candidateIndex: number, voterUid: string): Promise<void> {
  const database = requireDb();
  // Doc id = voter uid, so each friend can only have one vote per post (re-voting overwrites it).
  const vote: Vote = { id: voterUid, postId, candidateIndex, voterUid, createdAt: Date.now() };
  await setDoc(doc(database, "outfitPosts", postId, "votes", voterUid), vote);
}

export function watchVotes(postId: string, onChange: (votes: Vote[]) => void): Unsubscribe {
  const database = requireDb();
  const q = collection(database, "outfitPosts", postId, "votes");
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as Vote));
  });
}

export function tallyVotes(votes: Vote[], candidateCount: number): number[] {
  const tally = new Array(candidateCount).fill(0);
  for (const vote of votes) {
    if (vote.candidateIndex >= 0 && vote.candidateIndex < candidateCount) {
      tally[vote.candidateIndex]++;
    }
  }
  return tally;
}

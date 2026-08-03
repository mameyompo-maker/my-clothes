import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import {
  followId,
  threadId,
  type ChatMessage,
  type ChatThread,
  type ClosetCategory,
  type Wardrobe,
  type ClosetItem,
  type FacePattern,
  type Follow,
  type ItemTag,
  type OutfitCandidate,
  type OutfitPost,
  type PostComment,
  type PostVisibility,
  type Season,
  type StyleGenre,
  type StylePost,
  type UserProfile,
  type Vote,
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

/** 表示名からベースを作り、衝突しにくいよう末尾に乱数を足した初期ハンドル。 */
function generateHandle(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "user"}_${suffix}`;
}

// ---------- Users ----------

export async function ensureUserProfile(uid: string, name: string, avatarUrl: string | null): Promise<UserProfile> {
  const database = requireDb();
  const ref_ = doc(database, "users", uid);
  const snap = await getDoc(ref_);

  if (snap.exists()) {
    const existing = snap.data() as UserProfile;
    // 途中で追加したフィールドを既存ユーザーにも一度だけ埋める。
    if (existing.handle === undefined) {
      const patch = {
        handle: generateHandle(existing.name ?? name),
        bio: "",
        bodyType: "unknown" as const,
        personalColor: "unknown" as const,
        sizeTops: "",
        sizeBottoms: "",
        sizeShoes: "",
        favoriteGenres: [],
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        height: null,
        recommendMinuteOfDay: null,
      };
      await updateDoc(ref_, patch);
      return { ...existing, ...patch };
    }
    return existing;
  }

  const profile: UserProfile = {
    uid,
    name,
    avatarUrl,
    inviteCode: generateInviteCode(),
    friendUids: [],
    createdAt: Date.now(),
    handle: generateHandle(name),
    bio: "",
    height: null,
    bodyType: "unknown",
    personalColor: "unknown",
    sizeTops: "",
    sizeBottoms: "",
    sizeShoes: "",
    favoriteGenres: [],
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    recommendMinuteOfDay: null,
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

export type ProfileEditableFields = Pick<
  UserProfile,
  | "name"
  | "handle"
  | "bio"
  | "height"
  | "bodyType"
  | "personalColor"
  | "sizeTops"
  | "sizeBottoms"
  | "sizeShoes"
  | "favoriteGenres"
  | "recommendMinuteOfDay"
  | "avatarUrl"
  | "favoritePostIds"
  | "primaryWardrobe"
>;

export async function updateUserProfile(uid: string, patch: Partial<ProfileEditableFields>): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "users", uid), patch);
}

/**
 * プロフィール画像を差し替える。既定では Google アカウントの写真が入っているので、
 * 端末の写真から自由に変えられるようにするためのもの。
 * 過去の投稿に焼き込まれた ownerAvatarUrl は遡って書き換えない(件数が読めないため)。
 */
export async function updateAvatar(uid: string, file: Blob): Promise<string> {
  const avatarUrl = await uploadImage(`avatars/${uid}/${crypto.randomUUID()}.jpg`, file);
  await updateUserProfile(uid, { avatarUrl });
  return avatarUrl;
}

/** ハンドルの前方一致検索。ユーザー検索画面で使う。 */
export async function searchUsersByHandle(prefix: string, excludeUid: string): Promise<UserProfile[]> {
  const database = requireDb();
  const term = prefix.trim().toLowerCase().replace(/^@/, "");
  if (!term) return [];
  // U+F8FF は Unicode のほぼ最大値。前方一致をレンジ検索で表す定石。ソースに生の
  // 私用領域文字を置くと環境によって消えるので、コード側で組み立てる。
  const upperBound = term + String.fromCharCode(0xf8ff);
  const q = query(
    collection(database, "users"),
    where("handle", ">=", term),
    where("handle", "<=", upperBound),
    limit(20)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserProfile).filter((u) => u.uid !== excludeUid);
}

export interface RedeemInviteCodeResult {
  friendUid: string;
  friendName: string;
}

/**
 * 招待コードから相手を探し、双方の friendUids に相互登録する。Cloud Functions は使わず、
 * firestore.rules 側で「他人のドキュメントでも自分自身をfriendUidsに追加することだけ」を
 * 許可しているので、無料枠だけで完結する。
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

  // 招待コードを教え合った時点でお互い納得しているとみなし、その場で友達にする。
  // 同時にこちらからのフォローも張るので、相手がフォローバックすれば
  // 「相互フォロー = 友達」の状態とも一致する。
  const followRef = doc(database, "follows", followId(myUid, friendUid));
  if (!(await getDoc(followRef)).exists()) {
    const follow: Follow = { id: followRef.id, followerUid: myUid, followingUid: friendUid, createdAt: Date.now() };
    await setDoc(followRef, follow);
    await updateDoc(doc(database, "users", myUid), { followingCount: increment(1) });
    await updateDoc(doc(database, "users", friendUid), { followerCount: increment(1) });
  }

  await becomeFriends(myUid, friendUid);

  return { friendUid, friendName: (friendDoc.data() as UserProfile).name ?? "友達" };
}

// ---------- Follows ----------

export async function followUser(myUid: string, targetUid: string): Promise<void> {
  if (myUid === targetUid) throw new Error("自分自身はフォローできません。");
  const database = requireDb();
  const id = followId(myUid, targetUid);
  const followRef = doc(database, "follows", id);
  if ((await getDoc(followRef)).exists()) return;

  const follow: Follow = { id, followerUid: myUid, followingUid: targetUid, createdAt: Date.now() };
  await setDoc(followRef, follow);
  // カウンタは表示専用の非正規化値。多少ずれても機能は壊れないので個別更新でよい。
  await updateDoc(doc(database, "users", myUid), { followingCount: increment(1) });
  await updateDoc(doc(database, "users", targetUid), { followerCount: increment(1) });

  // 相手も自分をフォローしていたら相互フォロー成立 = 友達。
  if ((await getDoc(doc(database, "follows", followId(targetUid, myUid)))).exists()) {
    await becomeFriends(myUid, targetUid);
  }
}

export async function unfollowUser(myUid: string, targetUid: string): Promise<void> {
  const database = requireDb();
  const followRef = doc(database, "follows", followId(myUid, targetUid));
  if (!(await getDoc(followRef)).exists()) return;

  await deleteDoc(followRef);
  await updateDoc(doc(database, "users", myUid), { followingCount: increment(-1) });
  await updateDoc(doc(database, "users", targetUid), { followerCount: increment(-1) });

  // 片方が外れた時点で相互ではなくなるので、友達からも外す。
  await stopBeingFriends(myUid, targetUid);
}

/** 双方の friendUids に相手を入れる。ルール上、他人のドキュメントには自分しか足せない。 */
async function becomeFriends(myUid: string, otherUid: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "users", myUid), { friendUids: arrayUnion(otherUid) });

  const otherRef = doc(database, "users", otherUid);
  await runTransaction(database, async (tx) => {
    const snap = await tx.get(otherRef);
    const data = snap.data() as UserProfile | undefined;
    const current = data?.friendUids ?? [];
    if (current.includes(myUid)) return;
    tx.update(otherRef, { friendUids: [...current, myUid] });
  });
}

/** 双方の friendUids から外す。相手側は「自分を1件だけ削る」形しかルールが許さない。 */
async function stopBeingFriends(myUid: string, otherUid: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "users", myUid), { friendUids: arrayRemove(otherUid) });

  const otherRef = doc(database, "users", otherUid);
  await runTransaction(database, async (tx) => {
    const snap = await tx.get(otherRef);
    const data = snap.data() as UserProfile | undefined;
    const current = data?.friendUids ?? [];
    if (!current.includes(myUid)) return;
    tx.update(otherRef, { friendUids: current.filter((u) => u !== myUid) });
  });
}

export async function isFollowing(myUid: string, targetUid: string): Promise<boolean> {
  const database = requireDb();
  return (await getDoc(doc(database, "follows", followId(myUid, targetUid)))).exists();
}

export async function listFollowingUids(myUid: string): Promise<string[]> {
  const database = requireDb();
  const q = query(collection(database, "follows"), where("followerUid", "==", myUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => (d.data() as Follow).followingUid);
}

export async function listFollowerUids(myUid: string): Promise<string[]> {
  const database = requireDb();
  const q = query(collection(database, "follows"), where("followingUid", "==", myUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => (d.data() as Follow).followerUid);
}

// ---------- Images ----------

export async function uploadImage(path: string, file: Blob): Promise<string> {
  const bucket = requireStorage();
  const storageRef = ref(bucket, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

// ---------- Closet items ----------

export interface ClosetItemInput {
  category: ClosetCategory;
  label: string;
  brand: string;
  size: string;
  color: string;
  genres: StyleGenre[];
  seasons: Season[];
  memo: string;
}

export async function addClosetItem(ownerUid: string, input: ClosetItemInput, file: Blob): Promise<ClosetItem> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const imageUrl = await uploadImage(`closet/${ownerUid}/${id}.jpg`, file);
  const item: ClosetItem = {
    id,
    ownerUid,
    category: input.category,
    label: input.label,
    imageUrl,
    isSeed: false,
    createdAt: Date.now(),
    brand: input.brand,
    size: input.size,
    color: input.color,
    genres: input.genres,
    seasons: input.seasons,
    memo: input.memo,
    wearCount: 0,
    lastWornAt: null,
  };
  await setDoc(doc(database, "closetItems", id), item);
  return item;
}

export async function updateClosetItem(
  itemId: string,
  patch: Partial<Omit<ClosetItem, "id" | "ownerUid" | "createdAt">>
): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "closetItems", itemId), patch);
}

export async function deleteClosetItem(itemId: string): Promise<void> {
  const database = requireDb();
  await deleteDoc(doc(database, "closetItems", itemId));
}

export async function addSeedClosetItems(
  ownerUid: string,
  seedItems: { category: ClosetCategory; label: string; imageUrl: string; wardrobe?: Wardrobe }[]
): Promise<void> {
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
        brand: "",
        size: "",
        color: "",
        genres: [],
        seasons: [],
        memo: "",
        wearCount: 0,
        lastWornAt: null,
        wardrobe: seed.wardrobe ?? null,
      };
      return setDoc(doc(database, "closetItems", id), item);
    })
  );
}

/**
 * 初期クローゼットを入れ直す。
 *
 * サインイン時の投入は「クローゼットが空のとき」しか走らないため、既にアカウントを
 * 持っている人は初期クローゼットを選び直せない。実際、イラスト時代に作られた
 * アカウントは `/seed/*.svg` を指したまま取り残され、SVGを削除した時点で
 * 画像が全部壊れた。そこから復帰する手段としてこれを用意している。
 *
 * 自分で登録した服(isSeed:false)には触れない。消すのは初期投入分だけ。
 */
export async function replaceSeedClosetItems(
  ownerUid: string,
  seedItems: { category: ClosetCategory; label: string; imageUrl: string }[]
): Promise<void> {
  const existing = await listClosetItems(ownerUid);
  await Promise.all(existing.filter((i) => i.isSeed).map((i) => deleteClosetItem(i.id)));
  await addSeedClosetItems(ownerUid, seedItems);
}

export async function listClosetItems(ownerUid: string): Promise<ClosetItem[]> {
  const database = requireDb();
  const q = query(collection(database, "closetItems"), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ClosetItem).sort((a, b) => b.createdAt - a.createdAt);
}

/** 着用を記録する。よく着る服を上に出すためのカウンタ。 */
export async function markItemsWorn(itemIds: string[]): Promise<void> {
  const database = requireDb();
  const now = Date.now();
  await Promise.all(
    itemIds.map((id) =>
      updateDoc(doc(database, "closetItems", id), { wearCount: increment(1), lastWornAt: now }).catch(() => {
        // 削除済みアイテムなどは黙って飛ばす。着用記録は落ちても本筋を止めない。
      })
    )
  );
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

export async function deleteFacePattern(patternId: string): Promise<void> {
  const database = requireDb();
  await deleteDoc(doc(database, "facePatterns", patternId));
}

export const MAX_FACE_PATTERNS = 5;

// ---------- Outfit posts (2択) ----------

export async function createOutfitPost(
  ownerUid: string,
  mood: string,
  note: string,
  candidates: OutfitCandidate[],
  sharedWithUids: string[],
  buildMode: OutfitPost["buildMode"]
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
    decidedCandidateIndex: null,
    buildMode: buildMode ?? "topDown",
    deletedAt: null,
  };
  await setDoc(doc(database, "outfitPosts", id), post);
  return post;
}

/**
 * 今日の2択を取り消す。物理削除ではなく deletedAt を立てるだけ。
 * 取り消した回数を数えられなくなると無料プランの上限を守れないため
 * (詳しくは OutfitPost.deletedAt のコメント)。
 */
export async function undoOutfitPost(postId: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "outfitPosts", postId), { deletedAt: Date.now() });
}

export async function getOutfitPost(postId: string): Promise<OutfitPost | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "outfitPosts", postId));
  return snap.exists() ? (snap.data() as OutfitPost) : null;
}

/** 「実際にこっちを着る」と決めたときに呼ぶ。カレンダーの記録になる。 */
export async function decideOutfitCandidate(postId: string, candidateIndex: number): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "outfitPosts", postId), { decidedCandidateIndex: candidateIndex });
}

export function watchFeedPosts(myUid: string, onChange: (posts: OutfitPost[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts"), where("sharedWithUids", "array-contains", myUid));
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const posts = snap.docs
      .map((d) => d.data() as OutfitPost)
      .filter((p) => p.expiresAt > now && !p.deletedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
    onChange(posts);
  });
}

export function watchMyPosts(myUid: string, onChange: (posts: OutfitPost[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts"), where("ownerUid", "==", myUid), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as OutfitPost).filter((p) => !p.deletedAt));
  });
}

/**
 * 今日ぶんの2択を既に作っているか。
 *
 * 判定はクライアント側だけで、セキュリティルールでは縛っていない。ルールは
 * 「同じ人の今日の投稿件数」を数えられないため。厳密に止めたくなったら
 * Cloud Functions 側で作成を受け付ける形に変える必要がある。
 */
export async function hasCreatedOutfitToday(myUid: string): Promise<boolean> {
  const posts = await listMyOutfitPostsRaw(myUid);
  return posts.some((p) => p.createdAt >= startOfToday() && !p.deletedAt);
}

/** 今日ぶんの2択を取り消した回数。無料プランの上限判定に使う。 */
export async function countOutfitUndosToday(myUid: string): Promise<number> {
  const posts = await listMyOutfitPostsRaw(myUid);
  return posts.filter((p) => p.deletedAt && p.deletedAt >= startOfToday()).length;
}

/** 今日まだ生きている自分の2択。取り消しの対象を探すために使う。 */
export async function findTodaysOutfitPost(myUid: string): Promise<OutfitPost | null> {
  const posts = await listMyOutfitPostsRaw(myUid);
  return posts.find((p) => p.createdAt >= startOfToday() && !p.deletedAt) ?? null;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 取り消し済みも含む生の一覧。回数を数える用途にだけ使うこと。 */
async function listMyOutfitPostsRaw(myUid: string): Promise<OutfitPost[]> {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts"), where("ownerUid", "==", myUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as OutfitPost).sort((a, b) => b.createdAt - a.createdAt);
}

/** 画面に出す自分の2択。取り消したものは除く。 */
export async function listMyOutfitPosts(myUid: string): Promise<OutfitPost[]> {
  const posts = await listMyOutfitPostsRaw(myUid);
  return posts.filter((p) => !p.deletedAt);
}

// ---------- Votes ----------

export async function castVote(postId: string, candidateIndex: number, voterUid: string): Promise<void> {
  const database = requireDb();
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

// ---------- Style posts (全身写真・WEAR相当) ----------

export interface StylePostInput {
  caption: string;
  itemTags: ItemTag[];
  genres: StyleGenre[];
  season: Season | null;
  visibility: PostVisibility;
  outfitPostId: string | null;
}

export async function createStylePost(
  owner: UserProfile,
  input: StylePostInput,
  file: Blob
): Promise<StylePost> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const imageUrl = await uploadImage(`styles/${owner.uid}/${id}.jpg`, file);
  const post: StylePost = {
    id,
    ownerUid: owner.uid,
    ownerName: owner.name,
    ownerAvatarUrl: owner.avatarUrl ?? null,
    ownerHandle: owner.handle ?? "",
    imageUrl,
    caption: input.caption,
    itemTags: input.itemTags,
    genres: input.genres,
    season: input.season,
    visibility: input.visibility,
    likeCount: 0,
    commentCount: 0,
    createdAt: Date.now(),
    outfitPostId: input.outfitPostId,
  };
  await setDoc(doc(database, "stylePosts", id), post);
  await updateDoc(doc(database, "users", owner.uid), { postCount: increment(1) });
  return post;
}

export async function getStylePost(postId: string): Promise<StylePost | null> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "stylePosts", postId));
  return snap.exists() ? (snap.data() as StylePost) : null;
}

export async function deleteStylePost(post: StylePost): Promise<void> {
  const database = requireDb();
  await deleteDoc(doc(database, "stylePosts", post.id));
  await updateDoc(doc(database, "users", post.ownerUid), { postCount: increment(-1) });
}

/** 公開タイムライン。友達ゼロでも中身が見えるのがこの画面の狙い。 */
export function watchPublicStylePosts(onChange: (posts: StylePost[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(
    collection(database, "stylePosts"),
    where("visibility", "==", "public"),
    orderBy("createdAt", "desc"),
    limit(100)
  );
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as StylePost)));
}

export async function listUserStylePosts(ownerUid: string): Promise<StylePost[]> {
  const database = requireDb();
  const q = query(collection(database, "stylePosts"), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as StylePost).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 他人のプロフィールを開くときはこちらを使う。
 * 友達限定の投稿が1件でも混ざるとルール評価でクエリごと弾かれるため、
 * はじめから public だけに絞って取得する。
 */
export async function listPublicStylePostsOf(ownerUid: string): Promise<StylePost[]> {
  const database = requireDb();
  const q = query(
    collection(database, "stylePosts"),
    where("ownerUid", "==", ownerUid),
    where("visibility", "==", "public")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as StylePost).sort((a, b) => b.createdAt - a.createdAt);
}

/** お気に入りに指定された投稿だけを引く。消えている投稿は黙って除外する。 */
export async function getStylePostsByIds(ids: string[]): Promise<StylePost[]> {
  if (ids.length === 0) return [];
  const posts = await Promise.all(ids.map((id) => getStylePost(id).catch(() => null)));
  return posts.filter((p): p is StylePost => p !== null);
}

// ---------- Likes / Comments ----------

export async function toggleLike(postId: string, uid: string): Promise<boolean> {
  const database = requireDb();
  const likeRef = doc(database, "stylePosts", postId, "likes", uid);
  const exists = (await getDoc(likeRef)).exists();
  if (exists) {
    await deleteDoc(likeRef);
    await updateDoc(doc(database, "stylePosts", postId), { likeCount: increment(-1) });
    return false;
  }
  await setDoc(likeRef, { id: uid, postId, uid, createdAt: Date.now() });
  await updateDoc(doc(database, "stylePosts", postId), { likeCount: increment(1) });
  return true;
}

export async function hasLiked(postId: string, uid: string): Promise<boolean> {
  const database = requireDb();
  return (await getDoc(doc(database, "stylePosts", postId, "likes", uid))).exists();
}

export async function addComment(
  postId: string,
  author: UserProfile,
  text: string
): Promise<PostComment> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const comment: PostComment = {
    id,
    postId,
    uid: author.uid,
    name: author.name,
    avatarUrl: author.avatarUrl ?? null,
    text,
    createdAt: Date.now(),
  };
  await setDoc(doc(database, "stylePosts", postId, "comments", id), comment);
  await updateDoc(doc(database, "stylePosts", postId), { commentCount: increment(1) });
  return comment;
}

export function watchComments(postId: string, onChange: (comments: PostComment[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "stylePosts", postId, "comments"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as PostComment)));
}

// ---------- Chat (DM) ----------

export async function ensureChatThread(myUid: string, otherUid: string): Promise<ChatThread> {
  const database = requireDb();
  const id = threadId(myUid, otherUid);
  const ref_ = doc(database, "chatThreads", id);
  const snap = await getDoc(ref_);
  if (snap.exists()) return snap.data() as ChatThread;

  const thread: ChatThread = {
    id,
    memberUids: [myUid, otherUid].sort(),
    lastMessage: "",
    lastMessageAt: Date.now(),
    lastSenderUid: null,
  };
  await setDoc(ref_, thread);
  return thread;
}

export function watchChatThreads(myUid: string, onChange: (threads: ChatThread[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "chatThreads"), where("memberUids", "array-contains", myUid));
  return onSnapshot(q, (snap) => {
    const threads = snap.docs
      .map((d) => d.data() as ChatThread)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    onChange(threads);
  });
}

export function watchChatMessages(id: string, onChange: (messages: ChatMessage[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "chatThreads", id, "messages"), orderBy("createdAt", "asc"), limit(200));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as ChatMessage)));
}

export async function sendChatMessage(id: string, senderUid: string, text: string): Promise<void> {
  const database = requireDb();
  const messageId = crypto.randomUUID();
  const message: ChatMessage = { id: messageId, senderUid, text, createdAt: Date.now() };
  await setDoc(doc(database, "chatThreads", id, "messages", messageId), message);
  await updateDoc(doc(database, "chatThreads", id), {
    lastMessage: text,
    lastMessageAt: message.createdAt,
    lastSenderUid: senderUid,
  });
}

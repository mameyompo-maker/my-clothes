import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
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
  blockId,
  followId,
  threadId,
  type Block,
  type Report,
  type ChatMessage,
  type ChatThread,
  BODY_TYPES,
  normalizeHashtag,
  notificationText,
  type AppNotification,
  type NotificationType,
  PERSONAL_COLORS,
  STYLE_GENRES,
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
  type VoteReason,
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
  | "lastReadNotificationAt"
  | "priceViews"
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



// ---------- Notifications ----------

/**
 * 通知を1件送る。行為者側から相手の受信箱に直接書く。
 *
 * **失敗しても呼び出し元を巻き込まない。**いいねやフォローの本処理が
 * 通知の失敗で巻き戻るのは本末転倒なので、送信は投げっぱなしにする。
 */
export async function sendNotification(
  recipientUid: string,
  actor: UserProfile,
  type: NotificationType,
  postId: string | null
): Promise<void> {
  if (recipientUid === actor.uid) return; // 自分の行為で自分に通知しない
  const database = requireDb();
  const id = crypto.randomUUID();
  const notification: AppNotification = {
    id,
    type,
    actorUid: actor.uid,
    actorName: actor.name,
    actorAvatarUrl: actor.avatarUrl ?? null,
    postId,
    text: notificationText(type, actor.name),
    createdAt: Date.now(),
  };
  await setDoc(doc(database, "notifications", recipientUid, "items", id), notification);
}

export function watchNotifications(
  myUid: string,
  onChange: (items: AppNotification[]) => void
): Unsubscribe {
  const database = requireDb();
  const q = query(
    collection(database, "notifications", myUid, "items"),
    orderBy("createdAt", "desc"),
    limit(80)
  );
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as AppNotification)));
}

/** 既読にする。件数を持たず「どこまで読んだか」の時刻だけで数えるので、書き込みは1回で済む。 */
export async function markNotificationsRead(myUid: string): Promise<void> {
  await updateUserProfile(myUid, { lastReadNotificationAt: Date.now() });
}

// ---------- Blocks / Reports ----------

/**
 * ブロック。
 *
 * 相手の投稿・コメント・DMを自分の画面から消し、こちらからも見えなくする。
 * **判定はクライアント側の除外が主**で、ルールでは DM の作成だけを止めている。
 * すべてをルールで塞ごうとすると、投稿を1件読むたびに blocks を get することになり、
 * 読み取り課金と表示速度に跳ね返るため。相手に「ブロックされた」と通知はしない。
 */
export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  if (myUid === targetUid) throw new Error("自分自身はブロックできません。");
  const database = requireDb();
  const id = blockId(myUid, targetUid);
  const block: Block = { id, blockerUid: myUid, blockedUid: targetUid, createdAt: Date.now() };
  await setDoc(doc(database, "blocks", id), block);

  // つながりも切る。ブロックしたのにフィードに出続けるのは目的に反する。
  await Promise.allSettled([
    unfollowUser(myUid, targetUid),
    unfollowUser(targetUid, myUid),
  ]);
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  const database = requireDb();
  await deleteDoc(doc(database, "blocks", blockId(myUid, targetUid)));
}

/** 自分がブロックしている相手の一覧。表示のたびに引かず、起動時に1回読んで持ち回る。 */
export async function listBlockedUids(myUid: string): Promise<string[]> {
  const database = requireDb();
  const q = query(collection(database, "blocks"), where("blockerUid", "==", myUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => (d.data() as Block).blockedUid);
}

/** 自分をブロックしている相手。相手の画面から自分を隠すためではなく、逆方向の遮断に使う。 */
export async function listBlockedByUids(myUid: string): Promise<string[]> {
  const database = requireDb();
  const q = query(collection(database, "blocks"), where("blockedUid", "==", myUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => (d.data() as Block).blockerUid);
}

export async function reportContent(input: Omit<Report, "id" | "createdAt">): Promise<void> {
  const database = requireDb();
  const id = crypto.randomUUID();
  const report: Report = { ...input, id, createdAt: Date.now() };
  await setDoc(doc(database, "reports", id), report);
}


/**
 * はじめて入った人に出す「おすすめの人」。
 *
 * 誰ともつながっていない状態のフィードは空同然で、初日に離脱する最大の原因になる。
 * ここで効かせているのは **このアプリにしかない推薦軸**——骨格タイプ・パーソナルカラー・
 * 身長・好きなジャンルの近さ。「同じ骨格ウェーブの人の着こなし」は他のSNSでは作れない。
 *
 * 実装は素朴に「新しめのユーザーを最大200件読んで、その中で並べ替える」だけ。
 * 利用者が増えたら、事前計算した推薦テーブルに置き換える前提の暫定版。
 */
export async function suggestUsersToFollow(
  me: UserProfile,
  excludeUids: string[] = [],
  max = 8
): Promise<{ profile: UserProfile; reason: string }[]> {
  const database = requireDb();
  const snap = await getDocs(query(collection(database, "users"), limit(200)));
  const exclude = new Set([me.uid, ...me.friendUids, ...excludeUids]);

  const scored = snap.docs
    .map((d) => d.data() as UserProfile)
    .filter((u) => u.uid && !exclude.has(u.uid))
    .map((u) => {
      let score = 0;
      const reasons: string[] = [];

      // 公式は最初の1画面に必ず出したい。中身のある投稿が並んでいる可能性が高いため。
      if (u.official) {
        score += 6;
        reasons.push("公式アカウント");
      }
      if (me.bodyType && me.bodyType !== "unknown" && u.bodyType === me.bodyType) {
        score += 5;
        reasons.push(`骨格${BODY_TYPES.find((b) => b.value === u.bodyType)?.label ?? ""}が同じ`);
      }
      if (me.personalColor && me.personalColor !== "unknown" && u.personalColor === me.personalColor) {
        score += 4;
        reasons.push(PERSONAL_COLORS.find((c) => c.value === u.personalColor)?.label ?? "");
      }
      const sharedGenres = (u.favoriteGenres ?? []).filter((g) => (me.favoriteGenres ?? []).includes(g));
      if (sharedGenres.length > 0) {
        score += 2 * sharedGenres.length;
        reasons.push(`${STYLE_GENRES.find((g) => g.value === sharedGenres[0])?.label}が好き`);
      }
      if (me.height && u.height && Math.abs(me.height - u.height) <= 3) {
        score += 3;
        reasons.push("身長が近い");
      }
      // 投稿がある人を優先。空のプロフィールに飛ばしても何も起きないため。
      score += Math.min(u.postCount ?? 0, 5) * 0.6;

      return {
        profile: u,
        score,
        reason: reasons.slice(0, 2).join("・") || "新しく始めた人",
      };
    })
    .filter((x) => x.score > 0 || (x.profile.postCount ?? 0) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  return scored.map(({ profile, reason }) => ({ profile, reason }));
}

// ---------- Follows ----------

export async function followUser(myUid: string, targetUid: string, actor?: UserProfile | null): Promise<void> {
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

  if (actor) void sendNotification(targetUid, actor, "follow", null).catch(() => {});

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
  /** 値段(円)。未入力は null。 */
  price?: number | null;
  /** 値段を他の人にも見せるか。既定は false。 */
  pricePublic?: boolean;
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
    price: input.price ?? null,
    pricePublic: input.pricePublic ?? false,
  };
  await setDoc(doc(database, "closetItems", id), item);
  return item;
}

/** 投稿のアイテムタグなどから、IDでまとめて服を引く。存在しないIDは黙って落とす。 */
export async function getClosetItemsByIds(itemIds: string[]): Promise<ClosetItem[]> {
  const database = requireDb();
  const ids = Array.from(new Set(itemIds)).filter(Boolean);
  if (ids.length === 0) return [];
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(database, "closetItems", id))));
  return snaps.filter((s) => s.exists()).map((s) => s.data() as ClosetItem);
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
  seedItems: {
    category: ClosetCategory;
    label: string;
    imageUrl: string;
    wardrobe?: Wardrobe;
    hashtags?: string[];
  }[]
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
        hashtags: seed.hashtags ?? [],
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
  buildMode: OutfitPost["buildMode"],
  visibility: PostVisibility = "friends"
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
    visibility,
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

/**
 * 2択投稿を購読する。AI合成は投稿の作成後に非同期で書き込まれるので、
 * 1回のgetだと「合成待ち」のまま画面が止まって見える。合成が終わった瞬間に
 * 画像へ切り替わるよう、詳細画面ではこちらを使うこと。
 */
export function watchOutfitPost(postId: string, onChange: (post: OutfitPost | null) => void): Unsubscribe {
  const database = requireDb();
  return onSnapshot(doc(database, "outfitPosts", postId), (snap) =>
    onChange(snap.exists() ? (snap.data() as OutfitPost) : null)
  );
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

/**
 * 公開されている2択。友達でなくても投票できる。
 * 友達向けの `watchFeedPosts` とは別クエリで取り、画面側で重複を除いて混ぜる
 * (Firestore は OR 条件を1クエリで書けないため)。
 */
export function watchPublicOutfitPosts(
  myUid: string,
  onChange: (posts: OutfitPost[]) => void
): Unsubscribe {
  const database = requireDb();
  const q = query(
    collection(database, "outfitPosts"),
    where("visibility", "==", "public"),
    limit(60)
  );
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    onChange(
      snap.docs
        .map((d) => d.data() as OutfitPost)
        .filter((p) => p.expiresAt > now && !p.deletedAt && p.ownerUid !== myUid)
        .sort((a, b) => b.createdAt - a.createdAt)
    );
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

export async function castVote(
  postId: string,
  candidateIndex: number,
  voterUid: string,
  voter?: UserProfile | null
): Promise<void> {
  const database = requireDb();
  const vote: Vote = { id: voterUid, postId, candidateIndex, voterUid, createdAt: Date.now() };
  await setDoc(doc(database, "outfitPosts", postId, "votes", voterUid), vote);

  if (voter) {
    void getOutfitPost(postId).then((post) => {
      if (post) void sendNotification(post.ownerUid, voter, "vote", null).catch(() => {});
    });
  }
}

/**
 * 投票に理由スタンプを添える。投票済みの本人だけが自分の票を更新できる
 * (ルールの votes は create と update を同じ条件で許可している)。
 */
export async function setVoteReason(postId: string, voterUid: string, reason: VoteReason): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "outfitPosts", postId, "votes", voterUid), { reason });
}

/** 自分がこの2択に投票済みか。一覧で「未投票」を前に出すために使う。 */
export async function hasVotedOn(postId: string, uid: string): Promise<boolean> {
  const database = requireDb();
  const snap = await getDoc(doc(database, "outfitPosts", postId, "votes", uid));
  return snap.exists();
}

export function watchVotes(postId: string, onChange: (votes: Vote[]) => void): Unsubscribe {
  const database = requireDb();
  const q = collection(database, "outfitPosts", postId, "votes");
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as Vote));
  });
}

// ---------- Outfit comments (2択へのコメント) ----------

/**
 * 2択投稿へのコメント(2026-08-04 Kazさん依頼)。全身写真の投稿と同じ PostComment を使う。
 * stylePosts と違い commentCount は持たない: outfitPosts の update ルールは
 * ['decidedCandidateIndex', 'deletedAt'] しか許しておらず、他人がカウンタを
 * 増やせないため(2択は24時間で消えるので、件数の非正規化は不要と判断)。
 */
export async function addOutfitComment(postId: string, author: UserProfile, text: string): Promise<PostComment> {
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
  await setDoc(doc(database, "outfitPosts", postId, "comments", id), comment);

  // 通知は投げっぱなし。postId は /post/ への導線にしか使われないので null にしておく
  // (2択のコメントで /post/ に飛ばすと壊れる。castVote の通知と同じ扱い)。
  void getOutfitPost(postId).then((post) => {
    if (post && post.ownerUid !== author.uid) {
      void sendNotification(post.ownerUid, author, "comment", null).catch(() => {});
    }
  });
  return comment;
}

export function watchOutfitComments(postId: string, onChange: (comments: PostComment[]) => void): Unsubscribe {
  const database = requireDb();
  const q = query(collection(database, "outfitPosts", postId, "comments"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => d.data() as PostComment)));
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
  /** 市区町村レベルの地名。任意。 */
  placeName?: string | null;
  /** 正規化済みのハッシュタグ。服由来 + 本人入力の合流結果を渡すこと。 */
  hashtags?: string[];
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
    placeName: input.placeName ?? null,
    hashtags: input.hashtags ?? [],
  };
  await setDoc(doc(database, "stylePosts", id), post);
  await updateDoc(doc(database, "users", owner.uid), { postCount: increment(1) });
  return post;
}

/**
 * 投稿をあとから直す。直せるのは firestore.rules が許している項目だけ
 * (caption / itemTags / genres / season / visibility / placeName)。
 * 写真そのものは差し替えられない——差し替えを許すと、いいねが付いた後に
 * 中身をすり替えられてしまうため。
 */
export type StylePostEditableFields = Pick<
  StylePost,
  "caption" | "itemTags" | "genres" | "season" | "visibility" | "placeName" | "hashtags"
>;

export async function updateStylePost(
  postId: string,
  patch: Partial<StylePostEditableFields>
): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "stylePosts", postId), patch);
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

/**
 * ハッシュタグで公開投稿を引く。
 *
 * `array-contains` は1クエリに1つしか使えないので、複数タグのAND検索はできない。
 * 複合インデックス(visibility + hashtags + createdAt)が必要になるが、
 * Firestore が初回実行時にコンソールへ作成リンクを出すので、それを踏めばよい。
 */
export async function listStylePostsByHashtag(tag: string, max = 60): Promise<StylePost[]> {
  const database = requireDb();
  const normalized = normalizeHashtag(tag);
  if (!normalized) return [];
  const q = query(
    collection(database, "stylePosts"),
    where("visibility", "==", "public"),
    where("hashtags", "array-contains", normalized),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as StylePost)
    .sort((a, b) => b.createdAt - a.createdAt);
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

export async function toggleLike(postId: string, uid: string, actor?: UserProfile | null): Promise<boolean> {
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

  // 通知は投げっぱなし。失敗しても「いいね」自体は成立させる。
  if (actor) {
    void getStylePost(postId).then((post) => {
      if (post) void sendNotification(post.ownerUid, actor, "like", postId).catch(() => {});
    });
  }
  return true;
}


/**
 * 投稿の保存(ブックマーク)。
 *
 * likes と同じくドキュメントIDを uid に固定しているので、1人1保存が構造的に保証される。
 * ファッションでは「いいね」より「保存」のほうが強い意図を表すので、
 * 後々のレコメンドの材料としてはこちらのほうが価値が高い。
 */
export async function toggleSave(postId: string, uid: string): Promise<boolean> {
  const database = requireDb();
  const ref_ = doc(database, "stylePosts", postId, "saves", uid);
  if ((await getDoc(ref_)).exists()) {
    await deleteDoc(ref_);
    return false;
  }
  await setDoc(ref_, { id: uid, postId, uid, createdAt: Date.now() });
  return true;
}

export async function hasSaved(postId: string, uid: string): Promise<boolean> {
  const database = requireDb();
  return (await getDoc(doc(database, "stylePosts", postId, "saves", uid))).exists();
}

/** 保存した投稿の一覧。collectionGroup で自分の保存だけを横断的に集める。 */
export async function listSavedPosts(uid: string): Promise<StylePost[]> {
  const database = requireDb();
  const snap = await getDocs(
    query(collectionGroup(database, "saves"), where("uid", "==", uid), limit(100))
  );
  const postIds = snap.docs.map((d) => (d.data() as { postId: string }).postId);
  const posts = await getStylePostsByIds(postIds);
  return posts.sort((a, b) => b.createdAt - a.createdAt);
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

  void getStylePost(postId).then((post) => {
    if (post) void sendNotification(post.ownerUid, author, "comment", postId).catch(() => {});
  });
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

/** スレッド本体を購読する。相手の既読時刻(lastReadAt)をリアルタイムに拾うために使う。 */
export function watchChatThread(id: string, onChange: (thread: ChatThread | null) => void): Unsubscribe {
  const database = requireDb();
  return onSnapshot(doc(database, "chatThreads", id), (snap) =>
    onChange(snap.exists() ? (snap.data() as ChatThread) : null)
  );
}

/**
 * 自分の既読時刻を今に更新する。ルール側で「lastReadAt のうち自分のキーだけ」しか
 * 書けないように縛ってあるので、相手の既読を偽装することはできない。
 */
export async function markChatThreadRead(id: string, uid: string): Promise<void> {
  const database = requireDb();
  await updateDoc(doc(database, "chatThreads", id), { [`lastReadAt.${uid}`]: Date.now() });
}

export async function sendChatMessage(
  id: string,
  senderUid: string,
  text: string,
  imageUrl: string | null = null
): Promise<void> {
  const database = requireDb();
  const messageId = crypto.randomUUID();
  const message: ChatMessage = { id: messageId, senderUid, text, createdAt: Date.now(), imageUrl };
  await setDoc(doc(database, "chatThreads", id, "messages", messageId), message);
  await updateDoc(doc(database, "chatThreads", id), {
    lastMessage: text || "写真を送りました",
    lastMessageAt: message.createdAt,
    lastSenderUid: senderUid,
    // 送った本人にとっては読んだのと同じ。ここで一緒に進めておかないと、
    // 自分の送信で自分のスレッドが未読表示になる。
    [`lastReadAt.${senderUid}`]: message.createdAt,
  });
}

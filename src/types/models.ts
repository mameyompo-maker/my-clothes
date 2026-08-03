// ---------------------------------------------------------------------------
// カテゴリー
// ---------------------------------------------------------------------------

export type ClosetCategory =
  | "tops"
  | "bottoms"
  | "onepiece"
  | "outerwear"
  | "shoes"
  | "bag"
  | "accessories";

export const CLOSET_CATEGORIES: { value: ClosetCategory; label: string }[] = [
  { value: "tops", label: "トップス" },
  { value: "bottoms", label: "ボトムス" },
  { value: "onepiece", label: "ワンピース" },
  { value: "outerwear", label: "アウター" },
  { value: "shoes", label: "シューズ" },
  { value: "bag", label: "バッグ" },
  { value: "accessories", label: "アクセサリー" },
];

/** 上から順に決めていくフロー(頭 → 足元)で使う並び順。 */
export const CATEGORY_ORDER: ClosetCategory[] = [
  "outerwear",
  "tops",
  "onepiece",
  "bottoms",
  "shoes",
  "bag",
  "accessories",
];

// ---------------------------------------------------------------------------
// ジャンル / 季節 / 骨格
// ---------------------------------------------------------------------------

export type StyleGenre =
  | "casual"
  | "kirei"
  | "girly"
  | "mode"
  | "street"
  | "natural"
  | "classic"
  | "sporty"
  | "y2k"
  | "korean";

export const STYLE_GENRES: { value: StyleGenre; label: string }[] = [
  { value: "casual", label: "カジュアル" },
  { value: "kirei", label: "きれいめ" },
  { value: "girly", label: "ガーリー" },
  { value: "mode", label: "モード" },
  { value: "street", label: "ストリート" },
  { value: "natural", label: "ナチュラル" },
  { value: "classic", label: "クラシック" },
  { value: "sporty", label: "スポーティ" },
  { value: "y2k", label: "Y2K" },
  { value: "korean", label: "韓国系" },
];

export type Season = "spring" | "summer" | "autumn" | "winter";

export const SEASONS: { value: Season; label: string; emoji: string }[] = [
  { value: "spring", label: "春", emoji: "🌸" },
  { value: "summer", label: "夏", emoji: "☀️" },
  { value: "autumn", label: "秋", emoji: "🍂" },
  { value: "winter", label: "冬", emoji: "❄️" },
];

/** 月(1-12)から季節を割り出す。レコメンドと自動フィルタで使う。 */
export function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export type BodyType = "straight" | "wave" | "natural" | "unknown";

export const BODY_TYPES: { value: BodyType; label: string; hint: string }[] = [
  { value: "straight", label: "ストレート", hint: "上重心・立体的。Iラインやジャストサイズが得意" },
  { value: "wave", label: "ウェーブ", hint: "下重心・華奢。柔らかい素材やハイウエストが得意" },
  { value: "natural", label: "ナチュラル", hint: "骨格しっかり。ゆるっとしたシルエットが得意" },
  { value: "unknown", label: "わからない", hint: "未診断" },
];

export type PersonalColor = "spring" | "summer" | "autumn" | "winter" | "unknown";

export const PERSONAL_COLORS: { value: PersonalColor; label: string }[] = [
  { value: "spring", label: "イエベ春" },
  { value: "summer", label: "ブルベ夏" },
  { value: "autumn", label: "イエベ秋" },
  { value: "winter", label: "ブルベ冬" },
  { value: "unknown", label: "未診断" },
];

// ---------------------------------------------------------------------------
// ユーザー
// ---------------------------------------------------------------------------

export interface UserProfile {
  uid: string;
  name: string;
  avatarUrl: string | null;
  inviteCode: string;
  /**
   * 「友達」= お互いにフォローしている相手。相互フォロー状態を毎回2方向クエリせずに
   * 済ませるための非正規化キャッシュで、follow/unfollow のたびに両者ぶん更新している。
   * 招待コードで追加した相手も、同時にフォローを張ったうえでここに入る。
   */
  friendUids: string[];
  createdAt: number;

  // --- 以下はあとから追加したフィールド。既存ドキュメントには存在しないので必ず optional。
  /** @から始まる一意なユーザー名(Instagram のハンドル相当)。 */
  handle?: string;
  bio?: string;
  height?: number | null;
  bodyType?: BodyType;
  personalColor?: PersonalColor;
  sizeTops?: string;
  sizeBottoms?: string;
  sizeShoes?: string;
  favoriteGenres?: StyleGenre[];
  /** 非正規化したカウンタ。一覧表示のたびに集計しないで済ませるため。 */
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  /** レコメンド通知を受け取りたい時刻(分単位、0-1439)。null なら通知しない。 */
  recommendMinuteOfDay?: number | null;
  /** プロフィール上部に大きく出すお気に入りコーデ(StylePost の id、最大3件)。 */
  favoritePostIds?: string[];
  /**
   * 主に使う服。2択を作るとき、既定ではこちらの見本だけを出す。
   * 未設定なら見本の出し分けをしない(全部出す)。
   */
  primaryWardrobe?: Wardrobe;
  /**
   * 課金プラン。**クライアントからは書き換えられない**(firestore.rules で 'plan' の
   * 変更を禁止している)。決済確認後に Admin SDK 側から書き込む前提。
   * 自己申告で有料機能が開けてしまわないようにするため。
   */
  plan?: PlanTier;
}

export type PlanTier = "free" | "premium";

export function isPremium(profile: UserProfile | null): boolean {
  return profile?.plan === "premium";
}

export const MAX_FAVORITE_POSTS = 3;

/** 2択を作れる回数は1日1回。迷う時間を減らすアプリなので、朝に1回決め切る運用に寄せる。 */
export const OUTFIT_POSTS_PER_DAY = 1;

// ---------------------------------------------------------------------------
// クローゼット
// ---------------------------------------------------------------------------

export interface ClosetItem {
  id: string;
  ownerUid: string;
  category: ClosetCategory;
  label: string;
  imageUrl: string;
  isSeed: boolean;
  createdAt: number;

  // --- あとから追加したフィールド(既存ドキュメントには無い)。
  brand?: string;
  size?: string;
  color?: string;
  genres?: StyleGenre[];
  seasons?: Season[];
  memo?: string;
  /** 着用回数。よく着る服を上に出すため。 */
  wearCount?: number;
  lastWornAt?: number | null;
  /**
   * 見本の服がメンズ・ウィメンズどちらの一式に属するか。
   * 自分で登録した服には付かない(＝ null)。付いていない服は常に表示する。
   */
  wardrobe?: Wardrobe | null;
}

/** メンズかウィメンズか。「主に使う服」の設定と、見本の服の出し分けに使う。 */
export type Wardrobe = "men" | "women";

export const WARDROBE_LABELS: Record<Wardrobe, string> = {
  women: "ウィメンズ",
  men: "メンズ",
};

/** 反対側。「メンズの服も見る」の切り替えに使う。 */
export function otherWardrobe(w: Wardrobe): Wardrobe {
  return w === "men" ? "women" : "men";
}

/**
 * この服がどちらの一式のものか。
 *
 * 新しく入れた見本には `wardrobe` が入っているが、それ以前に入った見本には無い。
 * 画像の置き場所(`/seed/men/` か `/seed/women/`)から補えるので、
 * 移行作業をせずに済むようフォールバックしている。
 */
export function wardrobeOfItem(item: ClosetItem): Wardrobe | null {
  if (item.wardrobe) return item.wardrobe;
  if (item.imageUrl.startsWith("/seed/men/")) return "men";
  if (item.imageUrl.startsWith("/seed/women/")) return "women";
  return null;
}

export interface FacePattern {
  id: string;
  ownerUid: string;
  label: string;
  imageUrl: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// 2択コーデ投稿(このアプリの中心機能)
// ---------------------------------------------------------------------------

/** 服を決める順番の好み。 */
export type BuildMode = "topDown" | "hero";

export const BUILD_MODES: { value: BuildMode; label: string; description: string }[] = [
  { value: "topDown", label: "上から順に選ぶ", description: "アウター → トップス → ボトムス → 靴の順で埋めていく" },
  { value: "hero", label: "主役から選ぶ", description: "今日いちばん着たい一着を決めて、残りを合わせる" },
];

export interface OutfitCandidate {
  itemIds: string[];
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
  expiresAt: number;

  // --- あとから追加。
  /** 実際に着ることにした候補。カレンダーに出す「その日の服」はこれ。 */
  decidedCandidateIndex?: number | null;
  buildMode?: BuildMode;
  /**
   * 取り消した時刻。null なら生きている投稿。
   *
   * 物理削除ではなく印を付けるだけにしているのは、「今日なん回取り消したか」を
   * 数える必要があるため(無料プランは1日1回まで)。ドキュメントごと消すと
   * 数える対象が無くなり、何度でも作り直せてしまう。
   */
  deletedAt?: number | null;
}

/** 無料プランが1日に取り消せる回数。プレミアムは無制限。 */
export const FREE_UNDO_PER_DAY = 1;

export interface Vote {
  id: string;
  postId: string;
  candidateIndex: number;
  voterUid: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// 全身写真の投稿(WEAR / Instagram 相当。友達ゼロでも公開できる)
// ---------------------------------------------------------------------------

/** 写真上のどこにどのアイテムが写っているかを示すタグ(WEARのアイテムタグ相当)。 */
export interface ItemTag {
  itemId: string | null;
  label: string;
  brand: string;
  category: ClosetCategory | null;
  /** 画像に対する相対座標 (0-1)。 */
  x: number;
  y: number;
}

export type PostVisibility = "public" | "friends";

export interface StylePost {
  id: string;
  ownerUid: string;
  /** 一覧で毎回ユーザーを引かずに済むよう非正規化して持つ。 */
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerHandle: string;
  imageUrl: string;
  caption: string;
  itemTags: ItemTag[];
  genres: StyleGenre[];
  season: Season | null;
  visibility: PostVisibility;
  likeCount: number;
  commentCount: number;
  createdAt: number;
  /** 元になった2択投稿。カレンダー上で紐づけるために持つ。 */
  outfitPostId: string | null;
}

export interface PostLike {
  id: string;
  postId: string;
  uid: string;
  createdAt: number;
}

export interface PostComment {
  id: string;
  postId: string;
  uid: string;
  name: string;
  avatarUrl: string | null;
  text: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// フォロー
// ---------------------------------------------------------------------------

export interface Follow {
  /** `${followerUid}__${followingUid}`。1組1ドキュメントに固定するための合成ID。 */
  id: string;
  followerUid: string;
  followingUid: string;
  createdAt: number;
}

export function followId(followerUid: string, followingUid: string): string {
  return `${followerUid}__${followingUid}`;
}

// ---------------------------------------------------------------------------
// チャット(DM)
// ---------------------------------------------------------------------------

export interface ChatThread {
  /** 参加者2人のUIDをソートして連結したもの。同じ相手とのスレッドが重複しない。 */
  id: string;
  memberUids: string[];
  lastMessage: string;
  lastMessageAt: number;
  lastSenderUid: string | null;
}

export function threadId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAt: number;
}

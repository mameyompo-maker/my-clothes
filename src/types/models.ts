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
  /** 通知をどこまで読んだか。未読数を数えるためだけの値。 */
  lastReadNotificationAt?: number;
  /**
   * 公式・認証済みアカウント。ブランドや事務所の公式、スカウト対象のモデルなどに付ける。
   *
   * **クライアントからは書き換えられない**(`plan` と同じく firestore.rules で禁止)。
   * 自己申告で付けられると認証の意味が無くなるため、運営が Admin SDK から付ける前提。
   */
  official?: boolean;
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
  /**
   * この服そのものに付いたハッシュタグ(「#白シャツ」「#きれいめ」など)。
   *
   * **投稿にこの服をタグ付けすると、ここのタグが自動で投稿にも付く。**
   * 服を登録するときに一度書いておけば、着るたびに毎回タグを打ち直さずに済む。
   * 投稿側では本人が足したタグと合流させる(`mergeHashtags`)。
   */
  hashtags?: string[];
}

/**
 * ハッシュタグの正規化。
 *
 * 先頭の # を落とし、小文字化し、空白を除く。「#白シャツ」と「白シャツ」と
 * 「 #白シャツ 」が別タグとして散らばると、集まるはずの投稿が分断されるため、
 * **保存も検索も必ずこの関数を通した値で行う。**
 */
export function normalizeHashtag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  if (t.length > 30) return t.slice(0, 30);
  return t;
}

/** 文字列(スペース区切り・#付きどちらでも)をタグの配列にする。 */
export function parseHashtags(input: string): string[] {
  return dedupeHashtags(input.split(/[\s、,]+/).map(normalizeHashtag).filter((t): t is string => Boolean(t)));
}

/** キャプション本文から #タグ を拾う。本文に書いたタグも効くようにするため。 */
export function extractHashtagsFromText(text: string): string[] {
  const found = text.match(/#[^\s#、,]+/g) ?? [];
  return dedupeHashtags(found.map(normalizeHashtag).filter((t): t is string => Boolean(t)));
}

function dedupeHashtags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

/** 服由来のタグと本人が書いたタグを合流させる。上限は検索性を保つため20個。 */
export function mergeHashtags(...groups: (string[] | undefined)[]): string[] {
  const all: string[] = [];
  for (const g of groups) for (const t of g ?? []) all.push(t);
  return dedupeHashtags(all).slice(0, 20);
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
  /**
   * 公開範囲。既定は友達だけ(`undefined` の古い投稿も友達だけとして扱う)。
   *
   * public にすると、友達以外もフィードで見て投票できる。投票はタップ1回で済む
   * 最も参加コストの低い反応なので、このアプリで最も独自性のある機能を
   * 外から見える場所に出すための切り替え。
   */
  visibility?: PostVisibility;
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
  /**
   * その服を買えるページ。任意。
   *
   * 将来ここにアフィリエイトの計測パラメータを足せるよう、**リンクは1箇所
   * (`buildOutboundUrl`)を必ず通してから開く**ことにしている。呼び出し側が
   * 直接 href に入れてしまうと、後から差し込む場所が散らばって手が付けられなくなる。
   */
  url?: string;
}

/**
 * 外部サイトへ送り出すURL。今は素通しだが、アフィリエイト導入時はここだけ直せばよい。
 * 危険なスキーム(javascript: など)はここで弾く。
 */
export function buildOutboundUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // 例: url.searchParams.set("utm_source", "myclothes") をここに足す。
    return url.toString();
  } catch {
    return null;
  }
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

  // --- あとから追加。既存ドキュメントには無いので必ず optional。
  /**
   * 撮った場所。**市区町村までしか持たない**(緯度経度は保存しない)。
   * 若い利用者が多い想定なので、自宅が特定できる粒度の位置情報は最初から持たない。
   */
  placeName?: string | null;
  /**
   * 検索・集約に使うハッシュタグ。正規化済みの文字列だけを入れる。
   * タグ付けした服のタグ + キャプション中の #タグ + 本人が手で足したタグ の合流。
   */
  hashtags?: string[];
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
  /**
   * uid → その人がスレッドを最後に読んだ時刻。既読・未読はすべてこれとの比較で判定する。
   * メッセージ1件ずつにフラグを持たせると開くたびに全件更新が要るため、この形にしている。
   * 古いスレッドには存在しないので、読む側は必ず `?? 0` で補うこと。
   */
  lastReadAt?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

export type NotificationType = "like" | "comment" | "follow" | "vote";

/**
 * 通知。`notifications/{recipientUid}/items/{id}` に置く。
 *
 * **行為者(いいねを押した人)が相手の受信箱に直接書く。**Cloud Functions を挟むより
 * 速く、無料枠も使わない。書き込みはルールで「自分が actor である1件だけ」に縛る。
 * 反応があったことを本人に伝えない SNS は、投稿しても無風に感じて離脱するので、
 * これは体験の飾りではなく土台に近い。
 */
export interface AppNotification {
  id: string;
  type: NotificationType;
  actorUid: string;
  actorName: string;
  actorAvatarUrl: string | null;
  /** 対象の投稿。フォロー通知では null。 */
  postId: string | null;
  /** 一覧に出す短い本文。受信時点の文言を焼き込んでおく。 */
  text: string;
  createdAt: number;
}

export function notificationText(type: NotificationType, actorName: string): string {
  switch (type) {
    case "like":
      return `${actorName}さんがあなたの投稿にいいねしました`;
    case "comment":
      return `${actorName}さんがあなたの投稿にコメントしました`;
    case "follow":
      return `${actorName}さんがあなたをフォローしました`;
    case "vote":
      return `${actorName}さんがあなたの2択に投票しました`;
  }
}

// ---------------------------------------------------------------------------
// ブロックと通報
// ---------------------------------------------------------------------------

/**
 * ブロック。ID を `blocker__blocked` に固定しているので、
 * 「自分がその人をブロックしているか」をクエリなしで1件取得できる。
 */
export interface Block {
  id: string;
  blockerUid: string;
  blockedUid: string;
  createdAt: number;
}

export function blockId(blockerUid: string, blockedUid: string): string {
  return `${blockerUid}__${blockedUid}`;
}

export type ReportReason = "spam" | "harassment" | "inappropriate" | "impersonation" | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "いやがらせ・攻撃的" },
  { value: "inappropriate", label: "不適切な内容" },
  { value: "spam", label: "スパム・宣伝" },
  { value: "impersonation", label: "なりすまし" },
  { value: "other", label: "その他" },
];

/**
 * 通報。運営が後から読むための記録で、アプリ内では誰にも表示しない。
 * 本人にも読み返せないようにしてあるのは、通報したこと自体を相手に知られる経路を作らないため。
 */
export interface Report {
  id: string;
  reporterUid: string;
  /** 通報対象の種類。ユーザーそのものか、特定の投稿か。 */
  targetType: "user" | "stylePost" | "comment";
  targetId: string;
  targetOwnerUid: string;
  reason: ReportReason;
  detail: string;
  createdAt: number;
}

export function threadId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAt: number;
  /** 添付写真(Storage の chat/{uid}/ のダウンロードURL)。テキストのみの場合は null。 */
  imageUrl?: string | null;
}

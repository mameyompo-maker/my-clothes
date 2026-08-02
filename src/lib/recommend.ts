import {
  CATEGORY_ORDER,
  seasonOfMonth,
  type ClosetCategory,
  type ClosetItem,
  type Season,
  type StyleGenre,
} from "@/types/models";

/**
 * 手持ちの服だけからコーデ候補を組む。
 *
 * Gemini などの外部APIは使わない。画像生成には無料枠が無く、課金が切れると
 * 機能ごと死ぬため、提案の中核は必ずローカルで完結させている。
 * 「最近の流行り」を外から取ってくる代わりに、季節・本人の好きなジャンル・
 * 着用履歴という手元の情報だけでスコアリングしている。
 */

export interface ScoredItem {
  item: ClosetItem;
  score: number;
  reasons: string[];
}

export interface OutfitSuggestion {
  items: ClosetItem[];
  headline: string;
  reasons: string[];
}

/** 1着ごとのスコア。季節が合う・好きなジャンル・しばらく着ていない、を加点する。 */
export function scoreItem(
  item: ClosetItem,
  opts: { season: Season; favoriteGenres: StyleGenre[]; now: number }
): ScoredItem {
  const reasons: string[] = [];
  let score = 1;

  const seasons = item.seasons ?? [];
  if (seasons.includes(opts.season)) {
    score += 3;
    reasons.push("今の季節にぴったり");
  } else if (seasons.length === 0) {
    score += 1; // 通年扱い
  } else {
    score -= 2.5; // 季節外れ
  }

  const genres = item.genres ?? [];
  const genreHit = genres.filter((g) => opts.favoriteGenres.includes(g));
  if (genreHit.length > 0) {
    score += 1.5 * genreHit.length;
    reasons.push("好きなジャンル");
  }

  // しばらく着ていない服を掘り起こす。持っているのに忘れている服を減らすため。
  const lastWorn = item.lastWornAt ?? null;
  if (lastWorn === null) {
    score += 1.2;
    reasons.push("まだ着ていない");
  } else {
    const days = (opts.now - lastWorn) / (1000 * 60 * 60 * 24);
    if (days > 30) {
      score += 1.5;
      reasons.push("1ヶ月以上着ていない");
    } else if (days < 3) {
      score -= 2; // 直近に着たばかりの服は避ける
      reasons.push("最近着たばかり");
    }
  }

  // 完全な決め打ちにならないよう、わずかに揺らす。毎日同じ提案だと飽きるため。
  score += Math.random() * 0.8;

  return { item, score, reasons };
}

function pickBest(
  items: ClosetItem[],
  category: ClosetCategory,
  opts: { season: Season; favoriteGenres: StyleGenre[]; now: number },
  exclude: Set<string>
): ScoredItem | null {
  const pool = items.filter((i) => i.category === category && !exclude.has(i.id));
  if (pool.length === 0) return null;
  const scored = pool.map((i) => scoreItem(i, opts)).sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/**
 * 1コーデぶんの提案を作る。ワンピースが選ばれた場合はトップス/ボトムスを省く。
 * heroItem を渡すと、その1着を必ず含めて残りを組む(「主役から選ぶ」フロー用)。
 */
export function suggestOutfit(
  items: ClosetItem[],
  opts: { favoriteGenres: StyleGenre[]; heroItem?: ClosetItem | null; now?: number }
): OutfitSuggestion | null {
  if (items.length === 0) return null;

  const now = opts.now ?? Date.now();
  const season = seasonOfMonth(new Date(now).getMonth() + 1);
  const scoring = { season, favoriteGenres: opts.favoriteGenres, now };

  const chosen: ClosetItem[] = [];
  const reasons = new Set<string>();
  const used = new Set<string>();

  if (opts.heroItem) {
    chosen.push(opts.heroItem);
    used.add(opts.heroItem.id);
  }

  const hasOnepiece = chosen.some((i) => i.category === "onepiece");

  for (const category of CATEGORY_ORDER) {
    if (chosen.some((i) => i.category === category)) continue;

    // ワンピースがあるならトップス/ボトムスは不要。逆も同じ。
    if (category === "onepiece" && chosen.some((i) => i.category === "tops" || i.category === "bottoms")) continue;
    if ((category === "tops" || category === "bottoms") && hasOnepiece) continue;

    // アクセサリーとバッグは必須ではないので、無ければ飛ばす。
    const best = pickBest(items, category, scoring, used);
    if (!best) continue;

    // 季節外れで大きくマイナスになったものは無理に入れない。
    if (best.score < 0 && (category === "accessories" || category === "bag" || category === "outerwear")) continue;

    chosen.push(best.item);
    used.add(best.item.id);
    best.reasons.forEach((r) => reasons.add(r));

    if (category === "onepiece") break; // ワンピが決まったら上下は打ち切り
  }

  if (chosen.length === 0) return null;

  const seasonLabel = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" }[season];
  return {
    items: chosen,
    headline: `${seasonLabel}の気分で組んでみました`,
    reasons: Array.from(reasons).slice(0, 3),
  };
}

/** 2択ぶん、なるべく雰囲気の違う候補を作る。 */
export function suggestTwoOutfits(
  items: ClosetItem[],
  favoriteGenres: StyleGenre[]
): [OutfitSuggestion | null, OutfitSuggestion | null] {
  const first = suggestOutfit(items, { favoriteGenres });
  if (!first) return [null, null];

  // 1つ目に使った服を避けて2つ目を組み、見比べる意味のある2択にする。
  const firstIds = new Set(first.items.map((i) => i.id));
  const rest = items.filter((i) => !firstIds.has(i.id));
  const second = suggestOutfit(rest.length >= 2 ? rest : items, { favoriteGenres });

  return [first, second];
}

/** 「そろそろ服を決める時間ですよ」の文面。通知とホームのバナーで共用する。 */
export function recommendHeadline(itemCount: number): string {
  if (itemCount === 0) return "まずはクローゼットに服を登録しましょう";
  const hour = new Date().getHours();
  if (hour < 10) return "おはよう。今日の服、決めちゃおう";
  if (hour < 18) return "明日の服、先に決めておく?";
  return "明日の服を今のうちに決めておこう";
}

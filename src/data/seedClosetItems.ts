import type { ClosetCategory } from "@/types/models";

export interface SeedClosetItem {
  category: ClosetCategory;
  label: string;
  imageUrl: string;
}

/** 初期クローゼットの内容。オンボーディングで本人に選んでもらう。 */
export type WardrobeStyle = "men" | "women" | "both";

export const WARDROBE_STYLES: { value: WardrobeStyle; label: string; caption: string }[] = [
  { value: "women", label: "レディース", caption: "ブラウス・ワンピース・カーゴなど14点" },
  { value: "men", label: "メンズ", caption: "シャツ・スラックス・ローファーなど12点" },
  { value: "both", label: "両方ほしい", caption: "26点すべてをクローゼットに入れる" },
];

/**
 * 最初のクローゼットに入れておく実物の服。
 *
 * 以前はイラスト(SVG)だったが、実際の写真に差し替えた。服が主役のアプリで
 * イラストと写真が混ざると、自分で撮った服だけが浮いて見えるため。
 *
 * 画像は `public/seed/{men,women}/` に置いてある。元画像の解像度が低いので、
 * **大きく引き伸ばす表示には向かない**(グリッドのタイル程度に留めること)。
 * 同じファイル名で高解像度版を上書きすれば、ここを触らずに差し替えられる。
 */
const MEN_ITEMS: SeedClosetItem[] = [
  { category: "tops", label: "白シャツ", imageUrl: "/seed/men/white-shirt.png" },
  { category: "tops", label: "アイボリーシャツ", imageUrl: "/seed/men/ivory-shirt.png" },
  { category: "tops", label: "黒の長袖シャツ", imageUrl: "/seed/men/black-long-shirt.png" },
  { category: "tops", label: "ネイビーギンガムシャツ", imageUrl: "/seed/men/navy-gingham-shirt.png" },
  { category: "tops", label: "ネイビーチェックの半袖シャツ", imageUrl: "/seed/men/navy-check-short-shirt.png" },
  { category: "tops", label: "グレーのポロシャツ", imageUrl: "/seed/men/gray-polo-shirt.png" },
  { category: "tops", label: "黒のニットポロ", imageUrl: "/seed/men/black-knit-polo.png" },
  { category: "bottoms", label: "インディゴのワイドデニム", imageUrl: "/seed/men/indigo-wide-denim.png" },
  { category: "bottoms", label: "淡色のワイドデニム", imageUrl: "/seed/men/light-blue-wide-denim.png" },
  { category: "bottoms", label: "グレーのスラックス", imageUrl: "/seed/men/gray-slacks.png" },
  { category: "shoes", label: "黒のペニーローファー", imageUrl: "/seed/men/black-penny-loafer.png" },
  { category: "shoes", label: "黒の厚底ローファー", imageUrl: "/seed/men/black-chunky-loafer.png" },
];

const WOMEN_ITEMS: SeedClosetItem[] = [
  { category: "tops", label: "白の半袖ニット", imageUrl: "/seed/women/white-knit-tee.png" },
  { category: "tops", label: "サックスブルーのオーバーシャツ", imageUrl: "/seed/women/sax-blue-oversized-shirt.png" },
  { category: "tops", label: "チャコールの長袖カットソー", imageUrl: "/seed/women/charcoal-long-tee.png" },
  { category: "tops", label: "生成りのティアードキャミ", imageUrl: "/seed/women/ivory-tiered-camisole.png" },
  { category: "tops", label: "赤ギンガムのパフスリーブ", imageUrl: "/seed/women/red-gingham-puff-blouse.png" },
  { category: "tops", label: "白のフリルブラウス", imageUrl: "/seed/women/white-frill-blouse.png" },
  { category: "onepiece", label: "白のレースキャミワンピース", imageUrl: "/seed/women/white-lace-camisole-dress.png" },
  { category: "bottoms", label: "淡色のワイドデニム", imageUrl: "/seed/women/light-blue-wide-denim.png" },
  { category: "bottoms", label: "グレーのワイドスラックス", imageUrl: "/seed/women/gray-wide-slacks.png" },
  { category: "bottoms", label: "黒のワイドスラックス", imageUrl: "/seed/women/black-wide-slacks.png" },
  { category: "bottoms", label: "デニムのカーゴショーツ", imageUrl: "/seed/women/denim-cargo-shorts.png" },
  { category: "bottoms", label: "カーキのカーゴパンツ", imageUrl: "/seed/women/khaki-cargo-pants.png" },
  { category: "outerwear", label: "イエローの花柄カーディガン", imageUrl: "/seed/women/yellow-floral-cardigan.png" },
  { category: "outerwear", label: "ネイビーのレースカーディガン", imageUrl: "/seed/women/navy-lace-cardigan.png" },
];

export function seedItemsFor(style: WardrobeStyle): SeedClosetItem[] {
  if (style === "men") return MEN_ITEMS;
  if (style === "women") return WOMEN_ITEMS;
  return [...WOMEN_ITEMS, ...MEN_ITEMS];
}

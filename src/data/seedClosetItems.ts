import type { ClosetCategory, Wardrobe } from "@/types/models";

export interface SeedClosetItem {
  category: ClosetCategory;
  label: string;
  imageUrl: string;
  /** どちらの一式か。2択を作るときの出し分けに使う。 */
  wardrobe: Wardrobe;
  /**
   * この服に最初から付けておくハッシュタグ。
   * 投稿でこの服をタグ付けすると、これがそのまま投稿にも付く。
   * 見本の服にあらかじめ入れておくことで、登録直後の投稿でもタグが機能する。
   */
  hashtags: string[];
}

/** 初期クローゼットの内容。オンボーディングで本人に選んでもらう。 */
export type WardrobeStyle = Wardrobe | "both";

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
  { category: "tops", label: "白シャツ", imageUrl: "/seed/men/white-shirt.png", wardrobe: "men", hashtags: ["白シャツ", "シャツ", "きれいめ", "オフィスカジュアル", "定番"] },
  { category: "tops", label: "アイボリーシャツ", imageUrl: "/seed/men/ivory-shirt.png", wardrobe: "men", hashtags: ["シャツ", "生成り", "ナチュラル", "きれいめ"] },
  { category: "tops", label: "黒の長袖シャツ", imageUrl: "/seed/men/black-long-shirt.png", wardrobe: "men", hashtags: ["黒シャツ", "シャツ", "モード", "大人カジュアル"] },
  { category: "tops", label: "ネイビーギンガムシャツ", imageUrl: "/seed/men/navy-gingham-shirt.png", wardrobe: "men", hashtags: ["チェックシャツ", "ギンガム", "ネイビー", "カジュアル"] },
  { category: "tops", label: "ネイビーチェックの半袖シャツ", imageUrl: "/seed/men/navy-check-short-shirt.png", wardrobe: "men", hashtags: ["半袖シャツ", "チェック", "夏コーデ", "カジュアル"] },
  { category: "tops", label: "グレーのポロシャツ", imageUrl: "/seed/men/gray-polo-shirt.png", wardrobe: "men", hashtags: ["ポロシャツ", "グレー", "きれいめ", "夏コーデ"] },
  { category: "tops", label: "黒のニットポロ", imageUrl: "/seed/men/black-knit-polo.png", wardrobe: "men", hashtags: ["ニットポロ", "黒", "きれいめ", "大人カジュアル"] },
  { category: "bottoms", label: "インディゴのワイドデニム", imageUrl: "/seed/men/indigo-wide-denim.png", wardrobe: "men", hashtags: ["デニム", "ワイドパンツ", "インディゴ", "カジュアル"] },
  { category: "bottoms", label: "淡色のワイドデニム", imageUrl: "/seed/men/light-blue-wide-denim.png", wardrobe: "men", hashtags: ["デニム", "ワイドパンツ", "淡色", "カジュアル"] },
  { category: "bottoms", label: "グレーのスラックス", imageUrl: "/seed/men/gray-slacks.png", wardrobe: "men", hashtags: ["スラックス", "グレー", "きれいめ", "オフィスカジュアル"] },
  { category: "shoes", label: "黒のペニーローファー", imageUrl: "/seed/men/black-penny-loafer.png", wardrobe: "men", hashtags: ["ローファー", "黒", "きれいめ", "革靴"] },
  { category: "shoes", label: "黒の厚底ローファー", imageUrl: "/seed/men/black-chunky-loafer.png", wardrobe: "men", hashtags: ["ローファー", "厚底", "黒", "モード"] },
];

const WOMEN_ITEMS: SeedClosetItem[] = [
  { category: "tops", label: "白の半袖ニット", imageUrl: "/seed/women/white-knit-tee.png", wardrobe: "women", hashtags: ["白トップス", "ニット", "半袖", "シンプル", "定番"] },
  { category: "tops", label: "サックスブルーのオーバーシャツ", imageUrl: "/seed/women/sax-blue-oversized-shirt.png", wardrobe: "women", hashtags: ["オーバーサイズシャツ", "サックスブルー", "抜け感", "韓国系"] },
  { category: "tops", label: "チャコールの長袖カットソー", imageUrl: "/seed/women/charcoal-long-tee.png", wardrobe: "women", hashtags: ["カットソー", "長袖", "グレー", "シンプル"] },
  { category: "tops", label: "生成りのティアードキャミ", imageUrl: "/seed/women/ivory-tiered-camisole.png", wardrobe: "women", hashtags: ["キャミソール", "ティアード", "生成り", "ガーリー", "夏コーデ"] },
  { category: "tops", label: "赤ギンガムのパフスリーブ", imageUrl: "/seed/women/red-gingham-puff-blouse.png", wardrobe: "women", hashtags: ["ブラウス", "ギンガムチェック", "パフスリーブ", "ガーリー", "赤"] },
  { category: "tops", label: "白のフリルブラウス", imageUrl: "/seed/women/white-frill-blouse.png", wardrobe: "women", hashtags: ["ブラウス", "フリル", "白", "ガーリー", "甘め"] },
  { category: "onepiece", label: "白のレースキャミワンピース", imageUrl: "/seed/women/white-lace-camisole-dress.png", wardrobe: "women", hashtags: ["ワンピース", "レース", "白", "ガーリー", "夏コーデ"] },
  { category: "bottoms", label: "淡色のワイドデニム", imageUrl: "/seed/women/light-blue-wide-denim.png", wardrobe: "women", hashtags: ["デニム", "ワイドパンツ", "淡色", "カジュアル"] },
  { category: "bottoms", label: "グレーのワイドスラックス", imageUrl: "/seed/women/gray-wide-slacks.png", wardrobe: "women", hashtags: ["スラックス", "ワイドパンツ", "グレー", "きれいめ"] },
  { category: "bottoms", label: "黒のワイドスラックス", imageUrl: "/seed/women/black-wide-slacks.png", wardrobe: "women", hashtags: ["スラックス", "ワイドパンツ", "黒", "きれいめ", "オフィスカジュアル"] },
  { category: "bottoms", label: "デニムのカーゴショーツ", imageUrl: "/seed/women/denim-cargo-shorts.png", wardrobe: "women", hashtags: ["ショートパンツ", "カーゴ", "デニム", "カジュアル", "夏コーデ"] },
  { category: "bottoms", label: "カーキのカーゴパンツ", imageUrl: "/seed/women/khaki-cargo-pants.png", wardrobe: "women", hashtags: ["カーゴパンツ", "カーキ", "ストリート", "カジュアル"] },
  { category: "outerwear", label: "イエローの花柄カーディガン", imageUrl: "/seed/women/yellow-floral-cardigan.png", wardrobe: "women", hashtags: ["カーディガン", "花柄", "イエロー", "ガーリー", "羽織り"] },
  { category: "outerwear", label: "ネイビーのレースカーディガン", imageUrl: "/seed/women/navy-lace-cardigan.png", wardrobe: "women", hashtags: ["カーディガン", "ネイビー", "レース", "甘め", "羽織り"] },
];

export function seedItemsFor(style: WardrobeStyle): SeedClosetItem[] {
  if (style === "men") return MEN_ITEMS;
  if (style === "women") return WOMEN_ITEMS;
  return [...WOMEN_ITEMS, ...MEN_ITEMS];
}

import type { ClosetCategory } from "@/types/models";

export interface SeedClosetItem {
  category: ClosetCategory;
  label: string;
  imageUrl: string;
}

/**
 * 普遍的な服10種類。実際の写真を撮るのが面倒な最初のうちは、これをクローゼットに
 * 登録しておくことでアプリをすぐ試せるようにする。
 */
export const SEED_CLOSET_ITEMS: SeedClosetItem[] = [
  { category: "tops", label: "白Tシャツ", imageUrl: "/seed/tshirt.svg" },
  { category: "tops", label: "パーカー", imageUrl: "/seed/hoodie.svg" },
  { category: "bottoms", label: "デニムパンツ", imageUrl: "/seed/denim-pants.svg" },
  { category: "bottoms", label: "黒スキニーパンツ", imageUrl: "/seed/skinny-pants.svg" },
  { category: "outerwear", label: "テーラードジャケット", imageUrl: "/seed/jacket.svg" },
  { category: "shoes", label: "スニーカー", imageUrl: "/seed/sneaker.svg" },
  { category: "shoes", label: "レザーシューズ", imageUrl: "/seed/leather-shoe.svg" },
  { category: "accessories", label: "キャップ", imageUrl: "/seed/cap.svg" },
  { category: "accessories", label: "トートバッグ", imageUrl: "/seed/tote-bag.svg" },
  { category: "accessories", label: "腕時計", imageUrl: "/seed/watch.svg" },
];

"use client";

import Image from "next/image";
import type { ClosetCategory, ClosetItem } from "@/types/models";

/**
 * 選んだ服を「人が着ている姿」として1枚に組み上げる図。**AIを使わない。**
 *
 * 狙い(Kazさん指示 2026-08-06):
 * AI合成を使わなくても、全身のコーデがちゃんと伝わるようにする。ただし
 * 「枠にはめて並べるだけ」では着ている感じが出ないので、次の4点で作り込んでいる。
 *
 *  1. **カテゴリごとに幅をそろえ、高さは元の比率のまま**にする。
 *     枠に押し込む(object-fit だけ)と、正方形に近いシャツが横に広いシャツと同じ大きさに
 *     なってしまい、大小関係が嘘になる。幅をそろえて高さを比率で決めると、
 *     **丈の長短(ロングパンツ / ショーツ)とゆとり(オーバーサイズは横に広い)が保たれる。**
 *  2. **肩の線を固定し、そこに顔をぴったり乗せる。**顔と襟のあいだが空くと、
 *     とたんに「切り貼り」に見える。
 *  3. **重ね順を実際の着方に合わせる。**ボトムスの上にトップス、その上にアウター。
 *     裾がウエストに重なるので、ブラウスの裾がカーディガンから覗くような
 *     本物のレイヤードに見える。
 *  4. **床の影と服ごとの落ち影。**これが無いと全部が宙に浮いて見える。
 *
 * 想定する枠は 3:4(縦長)。横幅の比率で服の大きさを決めているので、
 * 極端に違う縦横比で使うと崩れる。
 */

interface Spec {
  /** 幅。枠の横幅に対する比率。 */
  w: number;
  /** 高さの上限。枠の高さに対する比率。ここで頭打ちになった服は全体が縮む(はみ出さない)。 */
  h: number;
  /** 上端の位置(枠の高さ比)。`fromBottom` のときは下端の位置。 */
  y: number;
  fromBottom?: boolean;
  /** 左右にずらす場合(バッグ・小物)。枠の横幅に対する比率で、中央からの距離。 */
  offsetX?: number;
  z: number;
}

/** 肩の線。顔の下端をここに合わせる。 */
const SHOULDER = 0.205;
/** 顔の直径(枠の高さ比)。 */
const FACE_D = 0.155;

const SPEC: Partial<Record<ClosetCategory, Spec>> = {
  outerwear: { w: 0.6, h: 0.33, y: 0.195, z: 4 },
  tops: { w: 0.52, h: 0.3, y: 0.21, z: 3 },
  onepiece: { w: 0.56, h: 0.62, y: 0.205, z: 3 },
  bottoms: { w: 0.44, h: 0.42, y: 0.485, z: 2 },
  shoes: { w: 0.27, h: 0.11, y: 0.05, fromBottom: true, z: 1 },
  // バッグと小物は体に重ならないよう脇に置く。無いことも多いので控えめに。
  bag: { w: 0.19, h: 0.16, y: 0.5, offsetX: 0.34, z: 5 },
  accessories: { w: 0.14, h: 0.12, y: 0.235, offsetX: -0.36, z: 5 },
};

/** 同じカテゴリが複数あっても1着だけ描く(2枚重ねると必ず汚くなる)。 */
function pickOnePerCategory(items: ClosetItem[]): ClosetItem[] {
  const seen = new Set<ClosetCategory>();
  const picked: ClosetItem[] = [];
  for (const item of items) {
    if (!SPEC[item.category] || seen.has(item.category)) continue;
    seen.add(item.category);
    picked.push(item);
  }
  return picked;
}

export function LookFigure({
  items,
  faceUrl,
  className = "",
}: {
  items: ClosetItem[];
  /** 今日の顔写真。無ければ顔なしで描く(服だけでも十分に伝わる)。 */
  faceUrl?: string | null;
  className?: string;
}) {
  const picked = pickOnePerCategory(items);

  return (
    <div
      className={`relative overflow-hidden bg-[radial-gradient(115%_75%_at_50%_4%,#ffffff_0%,#f7f9fc_46%,#e9eef6_100%)] ${className}`}
    >
      {/* 床の影。これがあるだけで「立っている」ように見える。 */}
      <span
        className="pointer-events-none absolute left-1/2 h-[3%] w-[41%] -translate-x-1/2 rounded-[50%]"
        style={{
          bottom: "3.2%",
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(30,40,60,.18), rgba(30,40,60,0))",
        }}
      />

      {picked.map((item) => {
        const s = SPEC[item.category];
        if (!s) return null;
        return (
          <div
            key={item.id}
            className="absolute"
            style={{
              left: `${50 + (s.offsetX ?? 0) * 100}%`,
              transform: "translateX(-50%)",
              [s.fromBottom ? "bottom" : "top"]: `${s.y * 100}%`,
              width: `${s.w * 100}%`,
              height: `${s.h * 100}%`,
              zIndex: s.z,
            }}
          >
            <Image
              src={item.imageUrl}
              alt={item.label}
              fill
              unoptimized
              className="object-contain object-top"
              style={{ filter: "drop-shadow(0 5px 9px rgba(30,40,60,.16))" }}
            />
          </div>
        );
      })}

      {faceUrl && (
        <div
          className="absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-full"
          style={{
            top: `${(SHOULDER - FACE_D) * 100}%`,
            height: `${FACE_D * 100}%`,
            aspectRatio: "1",
            zIndex: 8,
            boxShadow: "0 4px 12px rgba(30,40,60,.20), 0 0 0 3px #fff",
          }}
        >
          {/* 顔写真は引きで撮られていることが多いので、少し寄せて顔を大きく見せる。 */}
          <Image
            src={faceUrl}
            alt="今日の顔"
            fill
            unoptimized
            className="object-cover"
            style={{ transform: "scale(1.3)" }}
          />
        </div>
      )}

      {picked.length === 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          アイテム未選択
        </span>
      )}
    </div>
  );
}

"use client";

import Image from "next/image";
import type { BodyType, ClosetItem, FacePattern, OutfitCandidate } from "@/types/models";
import { LookFigure } from "./LookFigure";
import { IconSparkles } from "./icons";

/**
 * 1つのコーデ候補の見た目。
 *
 * AI合成(Gemini)が使えるときは合成画像を出す。使えないとき——Gemini の課金が切れている、
 * 合成が失敗した、まだ処理中——でも「顔写真 + 選んだ服」をボード風に必ず出す。
 * 合成が動かないと顔写真が画面のどこにも出ず、せっかく撮った意味が消えるため。
 */
export function OutfitCard({
  candidate,
  items,
  faces,
  className = "",
}: {
  candidate: OutfitCandidate;
  items: ClosetItem[];
  faces: FacePattern[];
  className?: string;
}) {
  const faceUrl =
    candidate.liveCaptureUrl ??
    faces.find((f) => f.id === candidate.facePatternId)?.imageUrl ??
    null;

  const outfitItems = candidate.itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is ClosetItem => Boolean(i));

  if (candidate.composedImageUrl) {
    return (
      <div className={`relative overflow-hidden rounded-2xl bg-surface-muted ${className}`}>
        <Image
          src={candidate.composedImageUrl}
          alt="AIが合成したコーデ"
          fill
          className="object-cover"
          unoptimized
        />
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          <IconSparkles className="h-3 w-3" /> AI
        </span>
      </div>
    );
  }

  // その場で撮った全身写真の候補。写真そのものを見せる(AI合成はしない)。
  if (candidate.photoUrl) {
    return (
      <div className={`relative overflow-hidden rounded-2xl bg-surface-muted ${className}`}>
        <Image src={candidate.photoUrl} alt="全身写真の候補" fill className="object-cover" unoptimized />
      </div>
    );
  }

  // AI合成が無いときは「着ている姿」を組み上げて見せる。
  // 以前は顔写真+服をタイル状に並べるだけだったが、それだと全身のコーデが伝わらない
  // (Kazさん指摘 2026-08-06)。LookFigure は服の大小・丈・重ね順を再現する。
  return (
    <LookFigure
      items={outfitItems}
      faceUrl={faceUrl}
      className={`rounded-2xl ${className}`}
    />
  );
}

/**
 * 候補に含まれるアイテムのラベルを並べたチップ列。投稿カードの下に添える。
 * ownerBodyType を渡すと、その骨格に合うと登録された服に「◎骨格」を付ける。
 * 見る側が「本人に似合う方」を選びやすくするための印。
 */
export function OutfitItemChips({
  candidate,
  items,
  ownerBodyType = null,
}: {
  candidate: OutfitCandidate;
  items: ClosetItem[];
  ownerBodyType?: BodyType | null;
}) {
  const outfitItems = candidate.itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is ClosetItem => Boolean(i));

  if (outfitItems.length === 0) return null;

  const suits = (item: ClosetItem) =>
    ownerBodyType && ownerBodyType !== "unknown" && (item.bodyTypes ?? []).includes(ownerBodyType);

  return (
    <div className="flex flex-wrap gap-1">
      {outfitItems.map((item) => (
        <span
          key={item.id}
          className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {item.brand ? `${item.brand} ` : ""}
          {item.label}
          {suits(item) ? " ◎骨格に合う" : ""}
        </span>
      ))}
    </div>
  );
}

"use client";

import Image from "next/image";
import type { ClosetItem, FacePattern, OutfitCandidate } from "@/types/models";
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

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface-muted ${className}`}>
      <div className="absolute inset-0 flex flex-col">
        {faceUrl && (
          <div className="relative flex h-[46%] items-center justify-center bg-surface-strong/40 pt-3">
            <div className="relative h-full w-auto" style={{ aspectRatio: "1 / 1" }}>
              <Image
                src={faceUrl}
                alt="今日の顔"
                fill
                className="rounded-full border-2 border-background object-cover"
                unoptimized
              />
            </div>
          </div>
        )}

        <div className={`grid flex-1 gap-[3px] p-[3px] ${gridClassFor(outfitItems.length)}`}>
          {outfitItems.map((item) => (
            <div key={item.id} className="relative overflow-hidden rounded-lg bg-surface">
              <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
            </div>
          ))}
          {outfitItems.length === 0 && (
            <div className="flex items-center justify-center text-[11px] text-muted-foreground">
              アイテム未選択
            </div>
          )}
        </div>
      </div>

      {candidate.composeStatus === "pending" && (
        <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          合成待ち
        </span>
      )}
    </div>
  );
}

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-3";
}

/** 候補に含まれるアイテムのラベルを並べたチップ列。投稿カードの下に添える。 */
export function OutfitItemChips({ candidate, items }: { candidate: OutfitCandidate; items: ClosetItem[] }) {
  const outfitItems = candidate.itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is ClosetItem => Boolean(i));

  if (outfitItems.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {outfitItems.map((item) => (
        <span
          key={item.id}
          className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {item.brand ? `${item.brand} ` : ""}
          {item.label}
        </span>
      ))}
    </div>
  );
}

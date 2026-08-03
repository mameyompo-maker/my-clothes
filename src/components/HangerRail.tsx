"use client";

import Image from "next/image";
import { useState } from "react";
import type { ClosetItem } from "@/types/models";
import { IconCheck } from "./icons";

/**
 * クローゼットのバーに服が吊るされている見た目。
 *
 * ただの写真グリッドにせず、上部にレールを引いてフックを描き、タップすると
 * 服が持ち上がるようにしている。「クローゼットを開けてハンガーから1着抜き取る」
 * という現実の動作に寄せるための演出。
 */
export function HangerRail({
  items,
  selectedIds,
  onSelect,
  columns = 3,
}: {
  items: ClosetItem[];
  /** 選択中として持ち上げたままにするアイテム。コーデ作成画面で使う。 */
  selectedIds?: string[];
  onSelect: (item: ClosetItem) => void;
  columns?: 2 | 3;
}) {
  // 行ごとにレールを引くため、列数で items を分割する。
  const rows: ClosetItem[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  return (
    <div className="space-y-6">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="relative">
          {/* レール本体 */}
          <div className="absolute left-0 right-0 top-[7px] h-[3px] rounded-full bg-gradient-to-r from-transparent via-border-strong to-transparent" />
          <div className={`grid gap-3 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {row.map((item) => (
              <HangingItem
                key={item.id}
                item={item}
                selected={selectedIds?.includes(item.id) ?? false}
                onSelect={() => onSelect(item)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HangingItem({
  item,
  selected,
  onSelect,
}: {
  item: ClosetItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);

  return (
    <button
      onClick={() => {
        setJustTapped(true);
        setTimeout(() => setJustTapped(false), 280);
        onSelect();
      }}
      className="group flex w-full flex-col items-center pt-[6px] text-left"
    >
      {/* ハンガーのフック */}
      <svg
        viewBox="0 0 24 16"
        className={`h-4 w-6 shrink-0 ${selected ? "text-accent" : "text-border-strong"} ${
          selected ? "" : "animate-sway"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d="M12 9V6.5a2 2 0 1 1 2-2" />
        <path d="M12 9 4 14h16z" />
      </svg>

      <div
        className={`relative w-full overflow-hidden rounded-xl bg-surface-muted transition-all duration-200 ${
          selected ? "hanger-selected ring-2 ring-accent" : justTapped ? "hanger-selected" : ""
        }`}
        style={{ aspectRatio: "3 / 4" }}
      >
        <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />

        {selected && (
          <span className="animate-pop-in absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <IconCheck className="h-3.5 w-3.5" />
          </span>
        )}

        {item.brand && (
          <span className="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-[9px] font-medium text-white">
            {item.brand}
          </span>
        )}
      </div>

      <span className="mt-1.5 w-full truncate text-center text-[11px] text-muted-foreground">{item.label}</span>
    </button>
  );
}

"use client";

import Image from "next/image";
import type { SVGProps } from "react";
import type { ClosetItem } from "@/types/models";
import { formatPrice } from "@/types/models";
import { IconStar } from "./icons";

/**
 * クローゼット画面の「木製ワードローブ」ヒーロー表示。
 *
 * Kazさん指定の参考画像(2026-08-04)を再現したもの: 扉が開いた木のワードローブの
 * 中央に、選択中の1着がハンガーで大きく掛かり、まわりに他の服のシルエットがぶら下がる。
 * 服の写真は切り抜けないので、白フチのカードをハンガーから吊るす形にしている。
 * 木の色はイラストとしての配色で、アプリのアクセント色(青)とは独立。
 */
export function WardrobeHero({
  item,
  onEdit,
}: {
  item: ClosetItem | null;
  /** 中央の服(または「詳細・編集」)をタップしたとき。 */
  onEdit: (item: ClosetItem) => void;
}) {
  return (
    <div className="mb-4 rounded-3xl bg-gradient-to-b from-[#c9a37a] to-[#ab835c] p-2 shadow-[var(--shadow-card)]">
      <div className="relative overflow-hidden rounded-2xl bg-[#f1e8da] px-4 pb-4 pt-8">
        {/* レール */}
        <div className="absolute left-[10%] right-[10%] top-6 h-1.5 rounded-full bg-gradient-to-b from-[#dcdcdc] to-[#a8a8a8]" />

        {/* 背景にぶら下がる他の服のシルエット */}
        <div className="pointer-events-none absolute left-[13%] top-[26px] flex gap-3 opacity-50">
          <ClothSilhouette className="h-24 w-9 text-[#b3a184]" />
          <ClothSilhouette className="h-20 w-8 text-[#a5977e]" />
        </div>
        <div className="pointer-events-none absolute right-[13%] top-[26px] flex gap-3 opacity-50">
          <ClothSilhouette className="h-20 w-8 text-[#a5977e]" />
          <ClothSilhouette className="h-24 w-9 text-[#b3a184]" />
        </div>

        {/* 開いた扉(左右)と取っ手 */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[8%] rounded-r-md bg-gradient-to-r from-[#a9825c] to-[#c9a37a] shadow-[2px_0_6px_rgba(0,0,0,0.18)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[8%] rounded-l-md bg-gradient-to-l from-[#a9825c] to-[#c9a37a] shadow-[-2px_0_6px_rgba(0,0,0,0.18)]" />
        <div className="pointer-events-none absolute left-[5.5%] top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-[#82613f]" />
        <div className="pointer-events-none absolute right-[5.5%] top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-[#82613f]" />

        {/* 中央: 選択中の1着。key を変えて選び直すたびにポップさせる */}
        <div key={item?.id ?? "empty"} className="relative z-10 flex flex-col items-center">
          <WoodHanger className="h-7 w-20 text-[#8a6844]" />
          {item ? (
            <>
              <button
                onClick={() => onEdit(item)}
                className="tappable animate-pop-in -mt-0.5 w-36 rounded-2xl bg-white p-1.5 shadow-xl"
              >
                <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-muted">
                  <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                  {item.favorite && (
                    <span className="absolute right-1.5 top-1.5 text-amber-400">
                      <IconStar className="h-4 w-4" fill="currentColor" />
                    </span>
                  )}
                </span>
              </button>
              <p className="mt-2 max-w-[220px] truncate text-sm font-bold text-[#54402c]">{item.label}</p>
              <p className="text-[11px] text-[#82613f]">
                {[item.brand, typeof item.price === "number" ? formatPrice(item.price) : null]
                  .filter(Boolean)
                  .join(" ・ ") || " "}
              </p>
              <button onClick={() => onEdit(item)} className="tappable mt-0.5 text-[11px] font-bold text-accent">
                詳細・編集
              </button>
            </>
          ) : (
            <div className="mt-1 flex aspect-[3/4] w-36 items-center justify-center rounded-2xl border-2 border-dashed border-[#bcab8d] px-3 text-center text-[11px] leading-relaxed text-[#82613f]">
              下の服をタップすると
              <br />
              ここに掛かります
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 白カードのグリッド。タップでワードローブ中央に掛け替え、星でお気に入り。
 * お気に入りはクローゼットとコーデ作成の一覧で先頭に浮く(よく着る服ほど早く手に取れる)。
 */
export function ClosetCardGrid({
  items,
  featuredId,
  onSelect,
  onToggleFavorite,
}: {
  items: ClosetItem[];
  featuredId: string | null;
  onSelect: (item: ClosetItem) => void;
  onToggleFavorite: (item: ClosetItem) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map((item) => (
        <div
          key={item.id}
          className={`relative rounded-2xl border bg-surface p-1.5 shadow-[var(--shadow-card)] transition-colors ${
            featuredId === item.id ? "border-accent" : "border-border"
          }`}
        >
          <button onClick={() => onSelect(item)} className="tappable block w-full">
            <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-muted">
              <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
            </span>
            <span className="mt-1 block w-full truncate text-center text-[11px] font-medium">{item.label}</span>
            <span className="block h-3.5 w-full truncate text-center text-[9px] text-muted-foreground">
              {typeof item.price === "number" ? formatPrice(item.price) : (item.brand ?? "")}
            </span>
          </button>
          <button
            onClick={() => onToggleFavorite(item)}
            aria-label={item.favorite ? "お気に入りから外す" : "お気に入りに追加"}
            className={`tappable absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 shadow ${
              item.favorite ? "text-amber-400" : "text-border-strong"
            }`}
          >
            <IconStar className="h-3.5 w-3.5" fill={item.favorite ? "currentColor" : "none"} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** 木のハンガー(フック+バー)。 */
function WoodHanger(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 80 26" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" {...props}>
      <path d="M40 12V7.5a3 3 0 1 1 3-3" />
      <path d="M40 12 8 23h64z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 背景用の服のシルエット(ハンガー+肩のあるかたまり)。 */
function ClothSilhouette(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 96" fill="currentColor" stroke="none" {...props}>
      <path d="M18 0c1.6 0 3 1.3 3 3 0 1-.5 1.8-1.2 2.4L28 12l8 6-3 78H3L0 18l8-6 8.2-6.6C15.5 4.8 15 4 15 3c0-1.7 1.4-3 3-3z" opacity="0.9" />
    </svg>
  );
}

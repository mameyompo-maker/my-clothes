"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type { SVGProps } from "react";
import type { ClosetItem } from "@/types/models";
import { formatPrice } from "@/types/models";
import { IconStar } from "./icons";

/**
 * クローゼット画面の「木製ワードローブ」表示。
 *
 * Kazさん指定の参考画像(2026-08-04)+追加指示(同日): 中央に選択中の1着、左右に
 * 前後の候補が実物の写真で見えていて、**横にスワイプするとレールの上を服が流れる**。
 * カテゴリタブ(ページ側でワードローブの直上に置く)で流す対象を絞る。
 *
 * スクロールは CSS scroll-snap に任せる(JSでアニメーションさせるより滑らかで、
 * 慣性スクロールもネイティブに乗る)。中央判定だけ scroll イベント+rAF で行い、
 * いちばん中央に近い服を選択中として親に知らせる。
 */
export function WardrobeCarousel({
  items,
  featuredId,
  onFeature,
  onEdit,
}: {
  items: ClosetItem[];
  /** 中央に掛かっている(=選択中の)アイテム。 */
  featuredId: string | null;
  /** スクロールやタップで中央の服が変わったとき。 */
  onFeature: (id: string) => void;
  /** 中央の服(または「詳細・編集」)をタップしたとき。 */
  onEdit: (item: ClosetItem) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const frameRef = useRef<number | null>(null);
  // 自分のスクロールで報告した id。グリッド側からの選択と区別して、
  // スクロール中に scrollIntoView が割り込んで引っ張り合いになるのを防ぐ。
  const reportedRef = useRef<string | null>(null);

  const featured = items.find((i) => i.id === featuredId) ?? items[0] ?? null;

  // 外(下のカードグリッド)から選択されたら、その服まで滑らかにスライドする。
  useEffect(() => {
    if (!featuredId || featuredId === reportedRef.current) return;
    const el = itemRefs.current[featuredId];
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [featuredId, items]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function handleScroll() {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const center = scroller.scrollLeft + scroller.clientWidth / 2;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const item of items) {
        const el = itemRefs.current[item.id];
        if (!el) continue;
        const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = item.id;
        }
      }
      if (bestId && bestId !== featuredId) {
        reportedRef.current = bestId;
        onFeature(bestId);
      }
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded-3xl bg-gradient-to-b from-[#c9a37a] to-[#ab835c] p-2 shadow-[var(--shadow-card)]">
      <div className="relative overflow-hidden rounded-2xl bg-[#f1e8da] pb-4 pt-6">
        {/* レール(服の後ろを通る) */}
        <div className="absolute left-[7%] right-[7%] top-[26px] h-1.5 rounded-full bg-gradient-to-b from-[#dcdcdc] to-[#a8a8a8]" />

        {/* 服が流れるカルーセル。px を 50%-中央カード半分 にして端の服も中央に来られるようにする */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="no-scrollbar relative flex snap-x snap-mandatory gap-3 overflow-x-auto px-[calc(50%-60px)] pt-0.5"
        >
          {items.map((item) => {
            const centered = item.id === (featured?.id ?? null);
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[item.id] = el;
                }}
                onClick={() => (centered ? onEdit(item) : onFeature(item.id))}
                aria-label={centered ? `${item.label} を編集` : `${item.label} を選ぶ`}
                className={`flex w-[120px] shrink-0 snap-center flex-col items-center transition-all duration-300 ${
                  centered ? "scale-105 opacity-100" : "scale-90 opacity-55"
                }`}
              >
                <WoodHanger className={`h-6 w-16 shrink-0 ${centered ? "text-[#82613f]" : "text-[#a58c6b]"}`} />
                <span className={`relative -mt-0.5 block w-full rounded-2xl bg-white p-1.5 ${centered ? "shadow-xl" : "shadow"}`}>
                  <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-muted">
                    <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                    {item.favorite && (
                      <span className="absolute right-1 top-1 text-amber-400">
                        <IconStar className="h-3.5 w-3.5" fill="currentColor" />
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 開いた扉(左右)。服の上に重ねて、端の候補が扉の奥へ流れていくように見せる */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[7%] rounded-r-md bg-gradient-to-r from-[#a9825c] to-[#c9a37a] shadow-[2px_0_6px_rgba(0,0,0,0.18)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[7%] rounded-l-md bg-gradient-to-l from-[#a9825c] to-[#c9a37a] shadow-[-2px_0_6px_rgba(0,0,0,0.18)]" />
        <div className="pointer-events-none absolute left-[4.5%] top-1/2 z-10 h-8 w-1 -translate-y-1/2 rounded-full bg-[#82613f]" />
        <div className="pointer-events-none absolute right-[4.5%] top-1/2 z-10 h-8 w-1 -translate-y-1/2 rounded-full bg-[#82613f]" />

        {/* 中央の服のキャプション */}
        {featured && (
          <div className="mt-2.5 px-[10%] text-center">
            <p className="truncate text-sm font-bold text-[#54402c]">{featured.label}</p>
            <p className="truncate text-[11px] text-[#82613f]">
              {[featured.brand, typeof featured.price === "number" ? formatPrice(featured.price) : null]
                .filter(Boolean)
                .join(" ・ ") || " "}
            </p>
            <button onClick={() => onEdit(featured)} className="tappable mt-0.5 text-[11px] font-bold text-accent">
              詳細・編集
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 白カードのグリッド(現状デザインを維持。タップの手間が少ない一覧として残す)。
 * タップすると上のワードローブがその服まで滑らかにスライドし、星でお気に入り。
 * お気に入りはクローゼットとコーデ作成の一覧で先頭に浮く。
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

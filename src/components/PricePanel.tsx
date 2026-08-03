"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { updateUserProfile } from "@/lib/firestore";
import {
  FREE_PRICE_VIEWS_PER_DAY,
  formatPrice,
  isPremium,
  localDateString,
  type ClosetItem,
} from "@/types/models";
import { IconTag } from "./icons";

/** 表示する1グループ。2択なら候補A/Bで2グループ、全身写真投稿なら1グループ。 */
export interface PriceGroup {
  title: string | null;
  items: ClosetItem[];
}

/**
 * コーデの値段表示。
 *
 * - 自分の投稿: いつでも見られる(非公開の値段も「非公開」の印つきで出す)
 * - 他人の投稿: 値段を公開しているアイテムだけが対象。無料プランは1日
 *   FREE_PRICE_VIEWS_PER_DAY コーデまで、プレミアムは無制限。
 * - 同じ投稿をその日のうちにもう一度開くのは消費しない(priceViews.postIds で判定)。
 *
 * 課金の勧誘はこのパネル内の1画面だけに留める(執拗な勧誘をしない方針)。
 */
export function PricePanel({
  postId,
  ownerUid,
  groups,
}: {
  postId: string;
  ownerUid: string;
  groups: PriceGroup[];
}) {
  const { user, profile, refreshProfile } = useAuth();
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const isOwner = user?.uid === ownerUid;
  const premium = isPremium(profile);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => typeof i.price === "number" && (isOwner || i.pricePublic)),
    }))
    .filter((g) => g.items.length > 0);
  // 見せられる値段が1つも無ければ、パネルごと出さない(画面を汚さない)。
  if (visibleGroups.length === 0) return null;

  const today = localDateString();
  const views = profile?.priceViews?.date === today ? profile.priceViews.postIds : [];
  const alreadyViewedThis = views.includes(postId);
  const quotaLeft = FREE_PRICE_VIEWS_PER_DAY - views.length;
  const canReveal = isOwner || premium || alreadyViewedThis || quotaLeft > 0;

  async function handleReveal() {
    if (busy) return;
    if (isOwner || premium || alreadyViewedThis) {
      setRevealed(true);
      return;
    }
    if (!user || quotaLeft <= 0) return;
    setBusy(true);
    try {
      // 先に今日の閲覧記録へ足してから開く。同じ投稿の2回目からは消費しない。
      await updateUserProfile(user.uid, { priceViews: { date: today, postIds: [...views, postId] } });
      await refreshProfile();
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!revealed) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-3">
        {canReveal ? (
          <button
            onClick={handleReveal}
            disabled={busy}
            className="tappable flex w-full items-center justify-between gap-2"
          >
            <span className="flex items-center gap-1.5 text-xs font-bold">
              <IconTag className="h-4 w-4 text-accent" /> このコーデの値段を見る
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {isOwner
                ? "自分の服"
                : premium
                  ? ""
                  : alreadyViewedThis
                    ? "今日見たコーデ"
                    : `無料は1日${FREE_PRICE_VIEWS_PER_DAY}コーデまで`}
            </span>
          </button>
        ) : (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <IconTag className="h-4 w-4" /> 値段は今日のぶんを見終わりました
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              無料プランで値段を見られるのは1日{FREE_PRICE_VIEWS_PER_DAY}コーデまでです。
              プレミアムなら制限なく見られます。
            </p>
            <Link href="/upgrade" className="mt-1.5 inline-block text-[11px] font-bold text-accent">
              プレミアムを見る →
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
        <IconTag className="h-4 w-4 text-accent" /> このコーデの値段
      </p>
      <div className={visibleGroups.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
        {visibleGroups.map((g, gi) => {
          const total = g.items.reduce((sum, i) => sum + (i.price ?? 0), 0);
          return (
            <div key={gi}>
              {g.title && <p className="mb-1 text-[11px] font-bold text-muted-foreground">{g.title}</p>}
              <ul className="space-y-1">
                {g.items.map((i) => (
                  <li key={i.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate text-muted-foreground">{i.label}</span>
                    <span className="shrink-0 font-semibold">
                      {formatPrice(i.price as number)}
                      {isOwner && !i.pricePublic && (
                        <span className="ml-1 text-[9px] font-normal text-muted-foreground">非公開</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex items-baseline justify-between border-t border-border pt-1.5 text-xs font-bold">
                <span>合計</span>
                <span>{formatPrice(total)}</span>
              </p>
            </div>
          );
        })}
      </div>
      {!isOwner && (
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          値段を公開しているアイテムだけの合計です。
        </p>
      )}
    </div>
  );
}

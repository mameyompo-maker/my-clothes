"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listClosetItems, listMyOutfitPosts, listUserStylePosts } from "@/lib/firestore";
import type { ClosetItem, OutfitPost, StylePost } from "@/types/models";
import { EmptyState, IconButton, Skeleton, TopBar } from "@/components/ui";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "@/components/icons";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

interface DayEntry {
  stylePost?: StylePost;
  outfitPost?: OutfitPost;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month: 0-11
  });
  const [stylePosts, setStylePosts] = useState<StylePost[] | null>(null);
  const [outfitPosts, setOutfitPosts] = useState<OutfitPost[]>([]);
  const [items, setItems] = useState<ClosetItem[]>([]);

  useEffect(() => {
    if (!user) return;
    listUserStylePosts(user.uid).then(setStylePosts);
    listMyOutfitPosts(user.uid).then(setOutfitPosts);
    listClosetItems(user.uid).then(setItems);
  }, [user]);

  // その日の記録。全身写真があればそれを優先し、無ければ「これを着る」と決めた2択を使う。
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry>();
    for (const p of outfitPosts) {
      if (p.decidedCandidateIndex == null) continue;
      map.set(dayKey(p.createdAt), { ...map.get(dayKey(p.createdAt)), outfitPost: p });
    }
    for (const p of stylePosts ?? []) {
      map.set(dayKey(p.createdAt), { ...map.get(dayKey(p.createdAt)), stylePost: p });
    }
    return map;
  }, [stylePosts, outfitPosts]);

  const { year, month } = cursor;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = first.getDay();

  const monthEntries = useMemo(() => {
    const list: { day: number; entry: DayEntry }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const entry = byDay.get(`${year}-${month + 1}-${d}`);
      if (entry) list.push({ day: d, entry });
    }
    return list;
  }, [byDay, year, month, daysInMonth]);

  function shift(delta: number) {
    setCursor((c) => {
      const next = new Date(c.year, c.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  const isCurrentMonth =
    year === new Date().getFullYear() && month === new Date().getMonth();

  return (
    <>
      <TopBar
        title="コーデの記録"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <IconButton label="前の月" onClick={() => shift(-1)}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
          <div className="text-center">
            <p className="text-lg font-extrabold">
              {year}年{month + 1}月
            </p>
            <p className="text-[11px] text-muted-foreground">{monthEntries.length}日ぶんの記録</p>
          </div>
          <IconButton label="次の月" onClick={() => shift(1)} disabled={isCurrentMonth}>
            <IconChevronRight className="h-5 w-5" />
          </IconButton>
        </div>

        {stylePosts === null ? (
          <Skeleton className="h-72" />
        ) : (
          <>
            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <span
                  key={w}
                  className={`text-center text-[10px] font-bold ${
                    i === 0 ? "text-danger/70" : i === 6 ? "text-accent/70" : "text-muted-foreground"
                  }`}
                >
                  {w}
                </span>
              ))}
            </div>

            <div className="mb-6 grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const entry = byDay.get(`${year}-${month + 1}-${day}`);
                const thumb = entry?.stylePost?.imageUrl ?? thumbFromOutfit(entry?.outfitPost, items);
                const href = entry?.stylePost
                  ? `/post/${entry.stylePost.id}`
                  : entry?.outfitPost
                    ? `/vote/${entry.outfitPost.id}`
                    : null;

                const cell = (
                  <div
                    className={`relative overflow-hidden rounded-lg ${
                      thumb ? "" : "border border-border bg-surface"
                    }`}
                    style={{ aspectRatio: "3 / 4" }}
                  >
                    {thumb ? (
                      <Image src={thumb} alt={`${day}日のコーデ`} fill className="object-cover" unoptimized />
                    ) : null}
                    <span
                      className={`absolute left-1 top-0.5 text-[9px] font-bold ${
                        thumb ? "text-white drop-shadow" : "text-muted-foreground"
                      }`}
                    >
                      {day}
                    </span>
                  </div>
                );

                return href ? (
                  <Link key={day} href={href} className="tappable">
                    {cell}
                  </Link>
                ) : (
                  <div key={day}>{cell}</div>
                );
              })}
            </div>

            {monthEntries.length === 0 ? (
              <EmptyState
                icon={<IconCalendar className="h-10 w-10" />}
                title="この月の記録はまだありません"
                description="2択で「こっちを着る」を選ぶか、全身写真を投稿すると、ここに残っていきます。"
              />
            ) : (
              <section>
                <h2 className="mb-3 text-sm font-bold">この月に着たコーデ</h2>
                <ul className="space-y-2">
                  {monthEntries
                    .slice()
                    .reverse()
                    .map(({ day, entry }) => {
                      const thumb = entry.stylePost?.imageUrl ?? thumbFromOutfit(entry.outfitPost, items);
                      const href = entry.stylePost
                        ? `/post/${entry.stylePost.id}`
                        : entry.outfitPost
                          ? `/vote/${entry.outfitPost.id}`
                          : "#";
                      const text =
                        entry.stylePost?.caption || entry.outfitPost?.mood || "この日のコーデ";
                      return (
                        <li key={day}>
                          <Link
                            href={href}
                            className="tappable flex items-center gap-3 rounded-2xl border border-border bg-surface p-2.5"
                          >
                            <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                              {thumb && <Image src={thumb} alt="" fill className="object-cover" unoptimized />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold">
                                {month + 1}月{day}日
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{text}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** 全身写真が無い日は、着ると決めた候補の1着目の写真をサムネイルにする。 */
function thumbFromOutfit(post: OutfitPost | undefined, items: ClosetItem[]): string | null {
  if (!post || post.decidedCandidateIndex == null) return null;
  const candidate = post.candidates[post.decidedCandidateIndex];
  if (!candidate) return null;
  if (candidate.composedImageUrl) return candidate.composedImageUrl;
  const firstItem = candidate.itemIds.map((id) => items.find((i) => i.id === id)).find(Boolean);
  return firstItem?.imageUrl ?? null;
}

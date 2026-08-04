"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { followUser, listOfficialUsers } from "@/lib/firestore";
import { cachedOnce, invalidateOnce } from "@/lib/liveStore";
import { thumbSrc, type ClosetItem, type OutfitPost, type StylePost, type UserProfile } from "@/types/models";
import { OutfitCard } from "./OutfitCard";
import { Avatar, VerifiedBadge } from "./ui";
import { IconVote } from "./icons";

/**
 * まだ誰もフォローしていない人に出す「プレビュー」。
 *
 * 狙い(Kazさん指示 2026-08-05):
 * フォローが5人以下のうちは、公式アカウントのコーデと2択が**勝手に流れて**きて、
 * アプリが動いている様子がひと目で分かるようにする。そのうえでフォローを促す。
 * 空のタイムラインを見せてしまうと、初日にそのまま離脱される。
 *
 * 読み込みを増やさないための約束:
 *  - **投稿・2択は親がすでに持っているものを絞り込むだけ**。ここから取りに行かない。
 *  - 公式アカウントの一覧だけは引くが、`cachedOnce` に通してセッション中は1回で済ませる。
 */

/** これ以下のフォロー数なら「まだ始めたばかり」とみなしてプレビューを出す。 */
export const PREVIEW_FOLLOW_THRESHOLD = 5;

const OFFICIALS_TTL_MS = 10 * 60 * 1000;

export function useOfficialUsers(enabled: boolean): UserProfile[] {
  const [users, setUsers] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void cachedOnce("officials", OFFICIALS_TTL_MS, () => listOfficialUsers(12))
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return users;
}

/** その場でフォローできる小さなボタン。プレビューの各所で使い回す。 */
export function FollowChip({ targetUid, size = "sm" }: { targetUid: string; size?: "sm" | "md" }) {
  const { user, profile, followingUids, refreshFollowing } = useAuth();
  const [done, setDone] = useState(false);
  const following = done || followingUids.includes(targetUid);
  if (!user || user.uid === targetUid) return null;

  return (
    <button
      type="button"
      disabled={following}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDone(true); // 先に反映して待たせない
        try {
          await followUser(user.uid, targetUid, profile);
          invalidateOnce("suggest");
          await refreshFollowing();
        } catch {
          setDone(false);
        }
      }}
      className={`tappable shrink-0 rounded-full font-bold ${
        size === "sm" ? "px-3 py-1 text-[10px]" : "px-4 py-1.5 text-xs"
      } ${following ? "border border-border text-muted-foreground" : "bg-accent text-accent-foreground"}`}
    >
      {following ? "フォロー中" : "フォロー"}
    </button>
  );
}

/**
 * 横に自動で流れる帯。指を置いている間と、端末が「動きを減らす」設定のときは止める。
 * スクロール位置を折り返すために同じ並びを2周ぶん描き、半分を過ぎたら先頭へ戻す。
 */
function AutoScrollRow({ children, itemCount }: { children: React.ReactNode; itemCount: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || itemCount === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      if (!paused.current && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += (dt / 1000) * 22; // 秒速22px。読める速さに抑える
        if (el.scrollLeft >= el.scrollWidth / 2) el.scrollLeft -= el.scrollWidth / 2;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [itemCount]);

  const hold = () => {
    paused.current = true;
  };
  const release = () => {
    paused.current = false;
  };

  return (
    <div
      ref={ref}
      onPointerDown={hold}
      onPointerUp={release}
      onPointerCancel={release}
      onMouseEnter={hold}
      onMouseLeave={release}
      onTouchStart={hold}
      onTouchEnd={release}
      className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4"
    >
      {children}
    </div>
  );
}

/**
 * ホームの先頭に出す公式プレビュー。公開タイムラインから公式アカウントの投稿だけを
 * 抜き出して流す(追加の読み込みは無し)。
 */
export function OfficialPostsPreview({ posts }: { posts: StylePost[] }) {
  const { followingUids, user } = useAuth();
  const enabled = followingUids.length <= PREVIEW_FOLLOW_THRESHOLD;
  const officials = useOfficialUsers(enabled);
  if (!enabled || officials.length === 0) return null;

  const officialUids = new Set(officials.map((u) => u.uid));
  const picks = posts.filter((p) => officialUids.has(p.ownerUid) && p.ownerUid !== user?.uid).slice(0, 12);
  if (picks.length === 0) return null;

  // 折り返しのために2周ぶん描く。key が重複しないよう周回番号を混ぜる。
  const looped = [...picks, ...picks];

  return (
    <section className="mb-5 px-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-bold">公式アカウントのコーデ</h2>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent">
          プレビュー
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        フォローすると、この人たちのコーデと2択が毎日ホームに届きます。
      </p>
      <AutoScrollRow itemCount={picks.length}>
        {/* フォローボタンはリンクの中に入れない(a の中に button を置かない)。
            並べて置き、写真と名前だけをリンクにする。 */}
        {looped.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface"
          >
            <Link href={`/post/${p.id}`} className="tappable block">
              <div className="relative w-full bg-surface-muted" style={{ aspectRatio: "3 / 4" }}>
                <Image
                  src={thumbSrc(p)}
                  alt={p.caption || "コーデ"}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex items-center gap-1 px-2 pt-1.5">
                <Avatar src={p.ownerAvatarUrl} name={p.ownerName} size={18} />
                <span className="truncate text-[10px] font-bold">{p.ownerName}</span>
                <VerifiedBadge size={10} />
              </div>
            </Link>
            <div className="px-2 pb-2 pt-1.5">
              <FollowChip targetUid={p.ownerUid} />
            </div>
          </div>
        ))}
      </AutoScrollRow>
    </section>
  );
}

/**
 * 2択一覧の先頭に出す公式プレビュー。こちらも親が購読済みの2択から絞り込むだけ。
 * 投票そのものは公開2択なので、フォローしていなくてもその場でできる。
 */
export function OfficialVotesPreview({
  outfits,
  ownerByUid,
  items,
}: {
  outfits: OutfitPost[];
  ownerByUid: Record<string, UserProfile>;
  /** 候補に写っている服。親が2択一覧のぶんをまとめて取ってあるものを渡す。 */
  items: ClosetItem[];
}) {
  const { followingUids } = useAuth();
  const enabled = followingUids.length <= PREVIEW_FOLLOW_THRESHOLD;
  const officials = useOfficialUsers(enabled);
  if (!enabled || officials.length === 0) return null;

  const officialUids = new Set(officials.map((u) => u.uid));
  const picks = outfits.filter((p) => officialUids.has(p.ownerUid)).slice(0, 8);
  if (picks.length === 0) return null;

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-bold">公式アカウントの2択</h2>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent">
          プレビュー
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        フォローしていなくても選んであげられます。フォローすると、その人の2択が毎朝ここに並びます。
      </p>
      <AutoScrollRow itemCount={picks.length}>
        {[...picks, ...picks].map((post, i) => {
          const owner = ownerByUid[post.ownerUid];
          return (
            <div
              key={`${post.id}-${i}`}
              className="w-52 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <div className="flex items-center gap-1.5 px-2.5 py-2">
                <Avatar src={owner?.avatarUrl} name={owner?.name ?? "ユーザー"} size={22} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-bold">
                  {owner?.name ?? "公式アカウント"}
                </span>
                <FollowChip targetUid={post.ownerUid} />
              </div>
              <Link href={`/vote/${post.id}`} className="tappable block">
                <div className="grid grid-cols-2 gap-[2px] px-[2px]">
                  {post.candidates.slice(0, 2).map((c, idx) => (
                    <OutfitCard
                      key={idx}
                      candidate={c}
                      items={items}
                      faces={[]}
                      className="aspect-[3/4] rounded-lg"
                    />
                  ))}
                </div>
                <p className="flex items-center gap-1 px-2.5 py-2 text-[11px] font-bold text-accent">
                  <IconVote className="h-3.5 w-3.5" />
                  選んであげる →
                </p>
              </Link>
            </div>
          );
        })}
      </AutoScrollRow>
    </section>
  );
}

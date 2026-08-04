"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listClosetItems,
  watchFollowedStylePosts,
  watchNotifications,
} from "@/lib/firestore";
import { subscribePublicPosts } from "@/lib/liveStore";
import { recommendHeadline } from "@/lib/recommend";
import { hasWeatherOptIn, loadTodayWeather, type TodayWeather } from "@/lib/weather";
import type { StylePost } from "@/types/models";
import { StylePostCard } from "@/components/StylePostCard";
import { WeatherBar } from "@/components/WeatherBar";
import { SuggestedUsers } from "@/components/SuggestedUsers";
import { OfficialPostsPreview, PREVIEW_FOLLOW_THRESHOLD } from "@/components/OfficialPreview";
import { Chip, EmptyState, IconButton, PrimaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconHeart, IconMessage, IconSearch, IconSparkles } from "@/components/icons";

/** 最初に描くカードの枚数。残りは下までスクロールしたぶんだけ足す。 */
const FIRST_PAGE = 6;
const PAGE_STEP = 6;

/** クローゼットの件数をローカルに覚えておくキー。CTAの文言だけに使う値なので、
 *  古くても実害がない。開くたびに服を全部読んでいたのを避けるためのもの。 */
const ITEM_COUNT_KEY = "mc.itemCount.";

export default function HomeFeedPage() {
  const { user, profile, hiddenUids, followingUids } = useAuth();
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  // フォロー中の人の「フォロワーだけ」投稿。公開分(posts)と混ぜて表示する。
  const [followedPosts, setFollowedPosts] = useState<StylePost[]>([]);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [shown, setShown] = useState(FIRST_PAGE);
  // 「今日の気温に近い日のコーデ」フィルタ。天気に同意している人にだけ出す。
  const [weather, setWeather] = useState<TodayWeather | null>(null);
  const [nearTempOnly, setNearTempOnly] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 公開タイムラインは liveStore の共有購読を使う。検索画面と同じ1本を見ているので、
  // 行き来しても読み直しが起きず、戻った瞬間に前の並びが出る。
  useEffect(() => subscribePublicPosts(setPosts), []);

  useEffect(() => {
    if (!user || followingUids.length === 0) return;
    return watchFollowedStylePosts(user.uid, followingUids, setFollowedPosts);
  }, [user, followingUids]);

  // クローゼットの件数はCTAの文言にしか使わないので、まず前回の値を出して、
  // 実数は裏で取り直す(開くたびに服を全部読んで待たせない)。
  useEffect(() => {
    if (!user) return;
    const key = ITEM_COUNT_KEY + user.uid;
    let cancelled = false;
    // 前回の件数は文言を早く出すためだけの値。effect の本体で同期に setState すると
    // レンダリングが連鎖するので、マイクロタスクに逃がしてから反映する。
    queueMicrotask(() => {
      const cached = Number(localStorage.getItem(key));
      if (!cancelled && Number.isFinite(cached) && cached > 0) setItemCount(cached);
    });
    listClosetItems(user.uid)
      .then((items) => {
        if (cancelled) return;
        setItemCount(items.length);
        localStorage.setItem(key, String(items.length));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!hasWeatherOptIn()) return;
    loadTodayWeather()
      .then(setWeather)
      .catch(() => setWeather(null));
  }, []);

  // 未読数は「最後に読んだ時刻より新しい通知の件数」。件数を別に持たないので、
  // どの端末で読んでも数がずれない。
  useEffect(() => {
    if (!user) return;
    return watchNotifications(user.uid, (list) => {
      const lastRead = profile?.lastReadNotificationAt ?? 0;
      setUnread(list.filter((n) => n.createdAt > lastRead && !hiddenUids.has(n.actorUid)).length);
    });
  }, [user, profile?.lastReadNotificationAt, hiddenUids]);

  // 公開投稿とフォロー中の人の「フォロワーだけ」投稿を合流。重複は id で潰し、新しい順。
  const allPosts = useMemo(() => {
    if (posts === null) return null;
    const seen = new Set<string>();
    // フォローを外した直後などに古い購読結果が残らないよう、フォロー0人なら混ぜない。
    const followed = followingUids.length > 0 ? followedPosts : [];
    return [...posts, ...followed]
      .filter((p) => {
        if (seen.has(p.id) || hiddenUids.has(p.ownerUid)) return false;
        seen.add(p.id);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [posts, followedPosts, followingUids, hiddenUids]);

  const visible = useMemo(() => {
    if (allPosts === null) return null;
    return nearTempOnly && weather
      ? allPosts.filter((p) => typeof p.tempC === "number" && Math.abs(p.tempC - weather.maxTemp) <= 3)
      : allPosts;
  }, [allPosts, nearTempOnly, weather]);

  // 下端が見えたら次のぶんを描く。**最初から全部描かない**のが要点で、
  // 20枚ぶんの写真を一度に読み込ませると、開いた直後がいちばん重くなる。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !visible || shown >= visible.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE_STEP);
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, shown]);

  const showOnboardingHelp = followingUids.length <= PREVIEW_FOLLOW_THRESHOLD;

  return (
    <>
      <TopBar
        left={<span className="gradient-text text-xl font-extrabold tracking-tight">My Clothes</span>}
        right={
          <>
            <Link href="/activity" aria-label="お知らせ" className="relative">
              <IconButton label="お知らせ">
                <IconHeart className="h-5 w-5" />
              </IconButton>
              {unread > 0 && (
                <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link href="/search" aria-label="さがす">
              <IconButton label="さがす">
                <IconSearch className="h-5 w-5" />
              </IconButton>
            </Link>
            <Link href="/chat" aria-label="メッセージ">
              <IconButton label="メッセージ">
                <IconMessage className="h-5 w-5" />
              </IconButton>
            </Link>
          </>
        }
      />

      <div className="mx-auto max-w-lg pb-28">
        <div className="px-4 pt-4">
          <div className="mb-3">
            <WeatherBar />
          </div>

          <Link
            href="/create"
            className="tappable mb-5 flex items-center gap-3 rounded-3xl border border-accent/30 bg-accent-soft p-4"
          >
            <IconSparkles className="h-6 w-6 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-accent">{recommendHeadline(itemCount ?? 0)}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {(itemCount ?? 0) > 0
                  ? `クローゼットの${itemCount}着から2択を組みます`
                  : "服を登録すると、ここから提案が届きます"}
              </p>
            </div>
          </Link>
        </div>

        {/* フォローが5人以下のうちは、公式アカウントのコーデが勝手に流れてくる。
            空のタイムラインを見せるより、動いている様子を見せてフォローに繋げる。 */}
        {allPosts && <OfficialPostsPreview posts={allPosts} />}

        {/* つながりが少ないうちは、投稿一覧より先におすすめを出す。 */}
        {showOnboardingHelp && (
          <div className="px-4">
            <SuggestedUsers />
          </div>
        )}

        {/* 天気に同意している人には「今日の気温に近い日のコーデ」で絞れるようにする。
            気温は投稿時に焼き込んだ tempC(無い投稿はフィルタ時に出ない)。 */}
        {weather && allPosts !== null && allPosts.length > 0 && (
          <div className="no-scrollbar mb-1 flex gap-2 overflow-x-auto px-4">
            <Chip size="sm" selected={!nearTempOnly} onClick={() => setNearTempOnly(false)}>
              すべて
            </Chip>
            <Chip size="sm" selected={nearTempOnly} onClick={() => setNearTempOnly(true)}>
              🌡 今日の気温に近い({Math.round(weather.maxTemp)}℃前後)
            </Chip>
          </div>
        )}

        {visible === null ? (
          <div className="space-y-6 px-4">
            <Skeleton className="h-[420px]" />
            <Skeleton className="h-[420px]" />
          </div>
        ) : visible.length === 0 ? (
          nearTempOnly ? (
            <p className="px-4 py-10 text-center text-xs leading-relaxed text-muted-foreground">
              今日の気温({Math.round(weather?.maxTemp ?? 0)}℃前後)に近い日のコーデはまだありません。
              <br />
              気温は投稿された日に記録されていくので、これから増えていきます。
            </p>
          ) : (
            <div className="px-4">
              <EmptyState
                title="まだ投稿がありません"
                description="今日のコーデを全身写真で投稿してみましょう。フォロワーがいなくても公開できます。"
                action={
                  <Link href="/post/new">
                    <PrimaryButton full={false}>最初の投稿をする</PrimaryButton>
                  </Link>
                }
              />
            </div>
          )
        ) : (
          <div>
            {visible.slice(0, shown).map((post) => (
              <StylePostCard key={post.id} post={post} myUid={user?.uid ?? null} />
            ))}
            <div ref={sentinelRef} />
            {shown < visible.length ? (
              <div className="space-y-6 px-4 py-6">
                <Skeleton className="h-[420px]" />
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {profile ? "ここまでが最新の投稿です" : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

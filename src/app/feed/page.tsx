"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listClosetItems, watchNotifications, watchPublicStylePosts } from "@/lib/firestore";
import { recommendHeadline } from "@/lib/recommend";
import { hasWeatherOptIn, loadTodayWeather, type TodayWeather } from "@/lib/weather";
import type { StylePost } from "@/types/models";
import { StylePostCard } from "@/components/StylePostCard";
import { WeatherBar } from "@/components/WeatherBar";
import { SuggestedUsers } from "@/components/SuggestedUsers";
import { Chip, EmptyState, IconButton, PrimaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconHeart, IconMessage, IconSearch, IconSparkles } from "@/components/icons";

export default function HomeFeedPage() {
  const { user, profile, hiddenUids } = useAuth();
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [unread, setUnread] = useState(0);
  // 「今日の気温に近い日のコーデ」フィルタ。天気に同意している人にだけ出す。
  const [weather, setWeather] = useState<TodayWeather | null>(null);
  const [nearTempOnly, setNearTempOnly] = useState(false);

  useEffect(() => {
    // ブロックした相手・自分をブロックした相手の投稿はフィードから外す。
    const unsub = watchPublicStylePosts((list) =>
      setPosts(list.filter((p) => !hiddenUids.has(p.ownerUid)))
    );
    return unsub;
  }, [hiddenUids]);

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid).then((items) => setItemCount(items.length));
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
              <p className="text-sm font-bold text-accent">{recommendHeadline(itemCount)}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {itemCount > 0
                  ? `クローゼットの${itemCount}着から2択を組みます`
                  : "服を登録すると、ここから提案が届きます"}
              </p>
            </div>
          </Link>
        </div>

        {/* つながりが少ないうちは、投稿一覧より先におすすめを出す。
            空のフィードを見せるより、まず誰かとつながってもらうほうが先。 */}
        {(profile?.friendUids.length ?? 0) < 3 && (
          <div className="px-4">
            <SuggestedUsers />
          </div>
        )}

        {/* 天気に同意している人には「今日の気温に近い日のコーデ」で絞れるようにする。
            気温は投稿時に焼き込んだ tempC(無い投稿はフィルタ時に出ない)。 */}
        {weather && posts !== null && posts.length > 0 && (
          <div className="no-scrollbar mb-1 flex gap-2 overflow-x-auto px-4">
            <Chip size="sm" selected={!nearTempOnly} onClick={() => setNearTempOnly(false)}>
              すべて
            </Chip>
            <Chip size="sm" selected={nearTempOnly} onClick={() => setNearTempOnly(true)}>
              🌡 今日の気温に近い({Math.round(weather.maxTemp)}℃前後)
            </Chip>
          </div>
        )}

        {posts === null ? (
          <div className="space-y-6 px-4">
            <Skeleton className="h-[420px]" />
            <Skeleton className="h-[420px]" />
          </div>
        ) : posts.length === 0 ? (
          <div className="px-4">
            <EmptyState
              title="まだ投稿がありません"
              description="今日のコーデを全身写真で投稿してみましょう。友達がいなくても公開できます。"
              action={
                <Link href="/post/new">
                  <PrimaryButton full={false}>最初の投稿をする</PrimaryButton>
                </Link>
              }
            />
          </div>
        ) : (
          (() => {
            const visible =
              nearTempOnly && weather
                ? posts.filter(
                    (p) => typeof p.tempC === "number" && Math.abs(p.tempC - weather.maxTemp) <= 3
                  )
                : posts;
            if (visible.length === 0) {
              return (
                <p className="px-4 py-10 text-center text-xs leading-relaxed text-muted-foreground">
                  今日の気温({Math.round(weather?.maxTemp ?? 0)}℃前後)に近い日のコーデはまだありません。
                  <br />
                  気温は投稿された日に記録されていくので、これから増えていきます。
                </p>
              );
            }
            return (
              <div>
                {visible.map((post) => (
                  <StylePostCard key={post.id} post={post} myUid={user?.uid ?? null} />
                ))}
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {profile ? "ここまでが最新の投稿です" : ""}
                </p>
              </div>
            );
          })()
        )}
      </div>
    </>
  );
}

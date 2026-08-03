"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  ensureChatThread,
  followUser,
  getStylePostsByIds,
  getUserProfile,
  isFollowing,
  listPublicStylePostsOf,
  unfollowUser,
} from "@/lib/firestore";
import { BODY_TYPES, PERSONAL_COLORS, STYLE_GENRES, threadId, type StylePost, type UserProfile } from "@/types/models";
import {
  Avatar,
  EmptyState,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  TopBar,
  VerifiedBadge,
} from "@/components/ui";
import { IconChevronLeft, IconGrid, IconMessage } from "@/components/icons";

export default function UserProfilePage() {
  const { uid } = useParams<{ uid: string }>();
  const router = useRouter();
  const { user, refreshProfile } = useAuth();

  const [target, setTarget] = useState<UserProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  const [favorites, setFavorites] = useState<StylePost[]>([]);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const isMe = user?.uid === uid;

  useEffect(() => {
    getUserProfile(uid).then(async (p) => {
      setTarget(p);
      if (!p) {
        setNotFound(true);
        return;
      }
      // 非公開の投稿がお気に入りに入っていることもあるので、読めなかったものは落とす。
      const favs = await getStylePostsByIds(p.favoritePostIds ?? []);
      setFavorites(favs.filter((f) => f.visibility === "public"));
    });
    listPublicStylePostsOf(uid).then(setPosts);
  }, [uid]);

  useEffect(() => {
    if (!user || isMe) return;
    isFollowing(user.uid, uid).then(setFollowing);
  }, [user, uid, isMe]);

  async function toggleFollow() {
    if (!user || following === null || busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    setTarget((t) => (t ? { ...t, followerCount: (t.followerCount ?? 0) + (next ? 1 : -1) } : t));
    try {
      if (next) await followUser(user.uid, uid);
      else await unfollowUser(user.uid, uid);
      await refreshProfile();
    } catch {
      setFollowing(!next);
      setTarget((t) => (t ? { ...t, followerCount: (t.followerCount ?? 0) + (next ? -1 : 1) } : t));
    } finally {
      setBusy(false);
    }
  }

  async function openChat() {
    if (!user) return;
    await ensureChatThread(user.uid, uid);
    router.push(`/chat/${threadId(user.uid, uid)}`);
  }

  if (isMe) {
    // 自分のページはマイページ側が本体。二重管理を避けるためそちらへ送る。
    router.replace("/profile");
    return null;
  }

  if (notFound) {
    return (
      <>
        <TopBar
          title="ユーザー"
          left={
            <IconButton label="戻る" onClick={() => router.back()}>
              <IconChevronLeft className="h-5 w-5" />
            </IconButton>
          }
        />
        <p className="mt-12 text-center text-sm text-muted-foreground">このユーザーは見つかりませんでした。</p>
      </>
    );
  }

  const bodyType = BODY_TYPES.find((b) => b.value === (target?.bodyType ?? "unknown"));
  const personalColor = PERSONAL_COLORS.find((p) => p.value === (target?.personalColor ?? "unknown"));
  const genres = (target?.favoriteGenres ?? [])
    .map((g) => STYLE_GENRES.find((x) => x.value === g)?.label)
    .filter(Boolean) as string[];

  return (
    <>
      <TopBar
        title={
          <span className="flex min-w-0 items-center justify-center gap-1">
            <span className="truncate">{target?.name ?? "ユーザー"}</span>
            {target?.official && <VerifiedBadge size={15} />}
          </span>
        }
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg pb-28">
        {!target ? (
          <div className="space-y-4 px-4 pt-5">
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <>
            <div className="px-4 pt-5">
              <div className="mb-4 flex items-center gap-5">
                <Avatar src={target.avatarUrl} name={target.name} size={78} ring />
                <div className="grid flex-1 grid-cols-3 text-center">
                  <Stat value={posts?.length ?? 0} label="投稿" />
                  <Stat value={target.followerCount ?? 0} label="フォロワー" />
                  <Stat value={target.followingCount ?? 0} label="フォロー中" />
                </div>
              </div>

              <div className="mb-3">
                {target.handle && <p className="text-xs text-muted-foreground">@{target.handle}</p>}
                {target.bio && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{target.bio}</p>}
              </div>

              <div className="mb-4 flex flex-wrap gap-1.5">
                {target.height ? <Tag>{target.height}cm</Tag> : null}
                {bodyType && bodyType.value !== "unknown" && <Tag>骨格{bodyType.label}</Tag>}
                {personalColor && personalColor.value !== "unknown" && <Tag>{personalColor.label}</Tag>}
                {genres.map((g) => (
                  <Tag key={g}>#{g}</Tag>
                ))}
              </div>

              {favorites.length > 0 && (
                <section className="mb-5">
                  <h2 className="mb-2 text-sm font-bold">お気に入りのコーデ</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {favorites.map((p) => (
                      <Link key={p.id} href={`/post/${p.id}`} className="tappable">
                        <div
                          className="relative overflow-hidden rounded-2xl bg-surface-muted"
                          style={{ aspectRatio: "3 / 4" }}
                        >
                          <Image src={p.imageUrl} alt={p.caption || "お気に入り"} fill className="object-cover" unoptimized />
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <div className="mb-6 flex gap-2">
                <div className="flex-1">
                  {following === null ? (
                    <SecondaryButton disabled>読み込み中</SecondaryButton>
                  ) : following ? (
                    <SecondaryButton onClick={toggleFollow} disabled={busy}>
                      フォロー中
                    </SecondaryButton>
                  ) : (
                    <PrimaryButton onClick={toggleFollow} disabled={busy}>
                      フォローする
                    </PrimaryButton>
                  )}
                </div>
                <button
                  onClick={openChat}
                  aria-label="メッセージを送る"
                  className="tappable flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface"
                >
                  <IconMessage className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="border-t border-border">
              <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold">
                <IconGrid className="h-4 w-4" /> 公開中の投稿
              </div>

              {posts === null ? (
                <div className="grid grid-cols-3 gap-[2px]">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-none" />
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="px-4 pb-6">
                  <EmptyState title="まだ公開投稿がありません" />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-[2px]">
                  {posts.map((p) => (
                    <Link key={p.id} href={`/post/${p.id}`} className="relative aspect-square bg-surface-muted">
                      <Image src={p.imageUrl} alt={p.caption || "投稿"} fill className="object-cover" unoptimized />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-lg font-extrabold leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] text-muted-foreground">{children}</span>;
}

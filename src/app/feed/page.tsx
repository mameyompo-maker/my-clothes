"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getFriendProfiles, watchFeedPosts, watchMyPosts } from "@/lib/firestore";
import type { OutfitPost, UserProfile } from "@/types/models";
import { IconClock } from "@/components/icons";

function timeLeftLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "投票終了";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `残り${hours}時間` : `残り${minutes}分`;
}

export default function FeedPage() {
  const { user, profile } = useAuth();
  const [myPosts, setMyPosts] = useState<OutfitPost[]>([]);
  const [friendPosts, setFriendPosts] = useState<OutfitPost[]>([]);
  const [ownerByUid, setOwnerByUid] = useState<Record<string, UserProfile>>({});

  useEffect(() => {
    if (!user) return;
    const unsubMine = watchMyPosts(user.uid, (posts) => setMyPosts(posts.filter((p) => p.expiresAt > Date.now())));
    const unsubFeed = watchFeedPosts(user.uid, setFriendPosts);
    return () => {
      unsubMine();
      unsubFeed();
    };
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    getFriendProfiles(profile.friendUids).then((friends) => {
      setOwnerByUid(Object.fromEntries(friends.map((f) => [f.uid, f])));
    });
  }, [profile]);

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-10">
      <h1 className="mb-5 text-xl font-bold">フィード</h1>

      {myPosts.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">あなたの投稿</h2>
          <div className="space-y-3">
            {myPosts.map((post) => (
              <PostCard key={post.id} post={post} ownerName="あなた" />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">友達の投稿</h2>
        {friendPosts.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">まだ投稿がありません。</p>
        ) : (
          <div className="space-y-3">
            {friendPosts.map((post) => (
              <PostCard key={post.id} post={post} ownerName={ownerByUid[post.ownerUid]?.name ?? "友達"} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PostCard({ post, ownerName }: { post: OutfitPost; ownerName: string }) {
  return (
    <Link
      href={`/feed/${post.id}`}
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
    >
      <div className="flex -space-x-6">
        {post.candidates.slice(0, 2).map((c, i) => (
          <div key={i} className="relative h-16 w-16 overflow-hidden rounded-xl ring-2 ring-surface">
            {c.composedImageUrl ? (
              <Image src={c.composedImageUrl} alt={`候補${i + 1}`} fill className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-muted text-[10px] text-muted-foreground">
                準備中
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{ownerName}</p>
        <p className="truncate text-xs text-muted-foreground">{post.mood}</p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <IconClock className="h-3.5 w-3.5" />
        {timeLeftLabel(post.expiresAt)}
      </span>
    </Link>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getFriendProfiles, listClosetItems, listFacePatterns, watchFeedPosts, watchMyPosts } from "@/lib/firestore";
import type { ClosetItem, FacePattern, OutfitPost, UserProfile } from "@/types/models";
import { OutfitCard } from "@/components/OutfitCard";
import { Avatar, EmptyState, PrimaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconClock, IconVote } from "@/components/icons";

function timeLeftLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "投票終了";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `残り${hours}時間` : `残り${minutes}分`;
}

export default function VoteListPage() {
  const { user, profile } = useAuth();
  const [myPosts, setMyPosts] = useState<OutfitPost[]>([]);
  const [friendPosts, setFriendPosts] = useState<OutfitPost[]>([]);
  const [ownerByUid, setOwnerByUid] = useState<Record<string, UserProfile>>({});
  const [myItems, setMyItems] = useState<ClosetItem[]>([]);
  const [myFaces, setMyFaces] = useState<FacePattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const unsubMine = watchMyPosts(user.uid, (posts) => {
      setMyPosts(posts.filter((p) => p.expiresAt > Date.now()));
      setLoading(false);
    });
    const unsubFeed = watchFeedPosts(user.uid, setFriendPosts);
    listClosetItems(user.uid).then(setMyItems);
    listFacePatterns(user.uid).then(setMyFaces);
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

  const nothing = myPosts.length === 0 && friendPosts.length === 0;

  return (
    <>
      <TopBar left={<span className="text-lg font-bold tracking-tight">今日の2択</span>} />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : nothing ? (
          <EmptyState
            icon={<IconVote className="h-10 w-10" />}
            title="まだ2択がありません"
            description="クローゼットから2パターン組んで、友達に選んでもらいましょう。友達がいなくても保存できます。"
            action={
              <Link href="/create">
                <PrimaryButton full={false}>コーデを作る</PrimaryButton>
              </Link>
            }
          />
        ) : (
          <div className="space-y-8">
            {friendPosts.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-bold">友達が迷っています</h2>
                <div className="space-y-4">
                  {friendPosts.map((post) => (
                    <PostSummaryCard
                      key={post.id}
                      post={post}
                      owner={ownerByUid[post.ownerUid]}
                      items={[]}
                      faces={[]}
                      cta="選んであげる"
                    />
                  ))}
                </div>
              </section>
            )}

            {myPosts.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-bold">あなたの2択</h2>
                <div className="space-y-4">
                  {myPosts.map((post) => (
                    <PostSummaryCard
                      key={post.id}
                      post={post}
                      owner={profile ?? undefined}
                      items={myItems}
                      faces={myFaces}
                      cta="結果を見る"
                      isMine
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function PostSummaryCard({
  post,
  owner,
  items,
  faces,
  cta,
  isMine = false,
}: {
  post: OutfitPost;
  owner?: UserProfile;
  items: ClosetItem[];
  faces: FacePattern[];
  cta: string;
  isMine?: boolean;
}) {
  return (
    <Link
      href={`/vote/${post.id}`}
      className="tappable block overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Avatar src={owner?.avatarUrl} name={owner?.name ?? "友達"} size={34} ring={!isMine} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{isMine ? "あなた" : (owner?.name ?? "友達")}</p>
          <p className="truncate text-xs text-muted-foreground">{post.mood || "今日のコーデ"}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
          <IconClock className="h-3 w-3" />
          {timeLeftLabel(post.expiresAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-[3px] px-[3px]">
        {post.candidates.slice(0, 2).map((candidate, i) => (
          <OutfitCard key={i} candidate={candidate} items={items} faces={faces} className="aspect-[3/4]" />
        ))}
      </div>

      <div className="px-3.5 py-3">
        <span className="text-sm font-bold text-accent">{cta} →</span>
      </div>
    </Link>
  );
}

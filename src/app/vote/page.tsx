"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  getFriendProfiles,
  getUserProfile,
  hasVotedOn,
  listClosetItems,
  listFacePatterns,
  listFollowingUids,
  watchFeedPosts,
  watchFollowedOutfitPosts,
  watchMyPosts,
  watchPublicOutfitPosts,
} from "@/lib/firestore";
import type { ClosetItem, FacePattern, OutfitPost, UserProfile } from "@/types/models";
import { OutfitCard } from "@/components/OutfitCard";
import { Avatar, EmptyState, PrimaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconClock, IconVote } from "@/components/icons";

function timeLeftLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "投票終了";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  // 公式サンプルなど期限の長い2択は「残り71時間」より「残り2日」の方が読める。
  if (hours >= 24) return `残り${Math.floor(hours / 24)}日`;
  return hours > 0 ? `残り${hours}時間` : `残り${minutes}分`;
}

export default function VoteListPage() {
  const { user, profile, hiddenUids } = useAuth();
  const [myPosts, setMyPosts] = useState<OutfitPost[]>([]);
  const [friendPosts, setFriendPosts] = useState<OutfitPost[]>([]);
  const [ownerByUid, setOwnerByUid] = useState<Record<string, UserProfile>>({});
  const [myItems, setMyItems] = useState<ClosetItem[]>([]);
  const [myFaces, setMyFaces] = useState<FacePattern[]>([]);
  const [loading, setLoading] = useState(true);
  // postId → 自分が投票済みか。未投票の2択を先頭に出すために引く。
  const [votedMap, setVotedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    const unsubMine = watchMyPosts(user.uid, (posts) => {
      setMyPosts(posts.filter((p) => p.expiresAt > Date.now()));
      setLoading(false);
    });
    // 「共有された2択」「公開の2択」「フォロー中の人の2択」の3本を別々に購読して混ぜる。
    // Firestore は OR 条件を1クエリで書けないため。重複は id で潰す。
    let fromFriends: OutfitPost[] = [];
    let fromPublic: OutfitPost[] = [];
    let fromFollowed: OutfitPost[] = [];
    const merge = () => {
      const seen = new Set<string>();
      const merged = [...fromFriends, ...fromPublic, ...fromFollowed].filter((p) => {
        if (seen.has(p.id) || hiddenUids.has(p.ownerUid)) return false;
        seen.add(p.id);
        return true;
      });
      setFriendPosts(merged.sort((a, b) => b.createdAt - a.createdAt));
    };
    const unsubFeed = watchFeedPosts(user.uid, (list) => {
      fromFriends = list;
      merge();
    });
    const unsubPublic = watchPublicOutfitPosts(user.uid, (list) => {
      fromPublic = list;
      merge();
    });
    // フォロー一覧は1回引けば十分(フォロー直後の反映は次に開いたときでよい)。
    let unsubFollowed: (() => void) | null = null;
    let cancelled = false;
    listFollowingUids(user.uid).then((uids) => {
      if (cancelled || uids.length === 0) return;
      unsubFollowed = watchFollowedOutfitPosts(user.uid, uids, (list) => {
        fromFollowed = list;
        merge();
      });
    });
    listClosetItems(user.uid).then(setMyItems);
    listFacePatterns(user.uid).then(setMyFaces);
    return () => {
      cancelled = true;
      unsubMine();
      unsubFeed();
      unsubPublic();
      unsubFollowed?.();
    };
  }, [user, hiddenUids]);

  useEffect(() => {
    if (!profile) return;
    getFriendProfiles(profile.friendUids).then((friends) => {
      setOwnerByUid(Object.fromEntries(friends.map((f) => [f.uid, f])));
    });
  }, [profile]);

  // 公開2択は友達以外(公式サンプル含む)も並ぶので、友達一覧に無い投稿主を補完する。
  useEffect(() => {
    const missing = Array.from(new Set(friendPosts.map((p) => p.ownerUid))).filter((u) => !ownerByUid[u]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map((u) => getUserProfile(u))).then((profiles) => {
      if (cancelled) return;
      const found = profiles.filter((p): p is UserProfile => p !== null);
      if (found.length > 0) {
        setOwnerByUid((prev) => ({ ...prev, ...Object.fromEntries(found.map((p) => [p.uid, p])) }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [friendPosts, ownerByUid]);

  // 自分が投票済みかを1件ずつ引く(votes/{自分のuid} の存在確認だけなので安い)。
  useEffect(() => {
    if (!user) return;
    const unknown = friendPosts.filter((p) => votedMap[p.id] === undefined);
    if (unknown.length === 0) return;
    let cancelled = false;
    Promise.all(unknown.map((p) => hasVotedOn(p.id, user.uid).catch(() => false))).then((results) => {
      if (cancelled) return;
      setVotedMap((prev) => ({
        ...prev,
        ...Object.fromEntries(unknown.map((p, i) => [p.id, results[i]])),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [friendPosts, user, votedMap]);

  // 未投票を先頭に。「まだ選んであげていない友達」から片付けられるようにする。
  const orderedFriendPosts = [...friendPosts].sort(
    (a, b) => Number(votedMap[a.id] ?? false) - Number(votedMap[b.id] ?? false)
  );

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
            description="クローゼットから2パターン組んで、みんなに選んでもらいましょう。フォロワーがいなくても保存できます。"
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
                <h2 className="mb-3 text-sm font-bold">みんなの2択</h2>
                <div className="space-y-4">
                  {orderedFriendPosts.map((post) => (
                    <PostSummaryCard
                      key={post.id}
                      post={post}
                      owner={ownerByUid[post.ownerUid]}
                      items={[]}
                      faces={[]}
                      cta={votedMap[post.id] ? "結果を見る" : "選んであげる"}
                      voted={votedMap[post.id] ?? false}
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
  voted = false,
}: {
  post: OutfitPost;
  owner?: UserProfile;
  items: ClosetItem[];
  faces: FacePattern[];
  cta: string;
  isMine?: boolean;
  voted?: boolean;
}) {
  return (
    <Link
      href={`/vote/${post.id}`}
      className="tappable block overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Avatar src={owner?.avatarUrl} name={owner?.name ?? "ユーザー"} size={34} ring={!isMine} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{isMine ? "あなた" : (owner?.name ?? "ユーザー")}</p>
          <p className="truncate text-xs text-muted-foreground">{post.mood || "今日のコーデ"}</p>
        </div>
        {!isMine && voted && (
          <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
            投票済み
          </span>
        )}
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

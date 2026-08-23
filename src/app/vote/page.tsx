"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  getClosetItemsByIds,
  getFriendProfiles,
  hasVotedOn,
  listClosetItems,
  listFacePatterns,
  watchFeedPosts,
  watchFollowedOutfitPosts,
  watchMyPosts,
  watchPublicOutfitPosts,
} from "@/lib/firestore";
import type { ClosetItem, FacePattern, OutfitPost, UserProfile } from "@/types/models";
import { OutfitCard } from "@/components/OutfitCard";
import { OfficialVotesPreview } from "@/components/OfficialPreview";
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
  const { user, profile, hiddenUids, followingUids } = useAuth();
  const [myPosts, setMyPosts] = useState<OutfitPost[]>([]);
  const [friendPosts, setFriendPosts] = useState<OutfitPost[]>([]);
  const [ownerByUid, setOwnerByUid] = useState<Record<string, UserProfile>>({});
  const [myItems, setMyItems] = useState<ClosetItem[]>([]);
  const [myFaces, setMyFaces] = useState<FacePattern[]>([]);
  // 他人の2択に写っている服。**一覧でもカードの中身を出すために要る**
  // (以前は空配列を渡していたので、他人の2択がすべて「アイテム未選択」になっていた)。
  const [otherItems, setOtherItems] = useState<ClosetItem[]>([]);
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
    // フォロー中の人の2択。フォロー一覧は AuthProvider が起動時に1回引いたものを使う。
    const unsubFollowed =
      followingUids.length > 0
        ? watchFollowedOutfitPosts(user.uid, followingUids, (list) => {
            fromFollowed = list;
            merge();
          })
        : null;
    listClosetItems(user.uid).then(setMyItems);
    listFacePatterns(user.uid).then(setMyFaces);
    return () => {
      unsubMine();
      unsubFeed();
      unsubPublic();
      unsubFollowed?.();
    };
  }, [user, hiddenUids, followingUids]);

  // 他人の2択に写っている服を、必要なぶんだけまとめて取る(30件ずつの in 検索)。
  // 相手のクローゼットを丸ごと読むより軽く、カードがきちんと絵になる。
  const neededItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of friendPosts) {
      for (const c of p.candidates) for (const id of c.itemIds) ids.add(id);
    }
    return Array.from(ids).sort().join(",");
  }, [friendPosts]);

  useEffect(() => {
    if (!neededItemIds) return;
    let cancelled = false;
    getClosetItemsByIds(neededItemIds.split(","))
      .then((items) => {
        if (!cancelled) setOtherItems(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [neededItemIds]);

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
    // 1人ずつ引かず、まとめて取る(getFriendProfiles は30件ずつの in 検索)。
    getFriendProfiles(missing).then((found) => {
      if (cancelled) return;
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
            {/* 自分の2択を一番上に置く(Kazさん指示 2026-08-22)。
                投稿した直後に自分の2択が見当たらないと「投稿できていないのでは」と
                不安になる。まず自分のぶんを見せて、その下に他の人が流れてくる形にする。 */}
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

            {/* フォローが5人以下のうちは、公式アカウントの2択が先頭を流れる。
                フォローしていなくても投票できるので、まず参加してもらう。 */}
            <OfficialVotesPreview
              outfits={orderedFriendPosts}
              ownerByUid={ownerByUid}
              items={otherItems}
            />

            {friendPosts.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-bold">みんなの2択</h2>
                <div className="space-y-4">
                  {orderedFriendPosts.map((post) => (
                    <PostSummaryCard
                      key={post.id}
                      post={post}
                      owner={ownerByUid[post.ownerUid]}
                      items={otherItems}
                      faces={[]}
                      cta={votedMap[post.id] ? "結果を見る" : "選んであげる"}
                      voted={votedMap[post.id] ?? false}
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  castVote,
  decideOutfitCandidate,
  getOutfitPost,
  getUserProfile,
  listClosetItems,
  listFacePatterns,
  markItemsWorn,
  tallyVotes,
  watchVotes,
} from "@/lib/firestore";
import type { ClosetItem, FacePattern, OutfitPost, UserProfile, Vote } from "@/types/models";
import { OutfitCard, OutfitItemChips } from "@/components/OutfitCard";
import { Avatar, IconButton, PrimaryButton, SecondaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconCamera, IconCheck, IconChevronLeft } from "@/components/icons";

export default function VoteDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<OutfitPost | null>(null);
  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [faces, setFaces] = useState<FacePattern[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [busy, setBusy] = useState(false);
  // 締め切り判定に使う現在時刻。描画中に Date.now() を読むと結果が安定しないので、
  // タイマー経由で state に落としてから使う。初期値0の間は「まだ締め切っていない」扱い。
  const [now, setNow] = useState(0);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    getOutfitPost(postId).then(async (p) => {
      setPost(p);
      if (!p) return;
      setOwner(await getUserProfile(p.ownerUid));
      setItems(await listClosetItems(p.ownerUid));
      // 顔写真は本人しか読めない(facePatterns のルール)。他人の投稿では空のままでよい。
      if (p.ownerUid === user?.uid) setFaces(await listFacePatterns(p.ownerUid));
    });
  }, [postId, user?.uid]);

  useEffect(() => watchVotes(postId, setVotes), [postId]);

  if (!post) {
    return (
      <>
        <TopBar title="読み込み中" />
        <div className="mx-auto max-w-lg space-y-3 px-4 pt-4">
          <Skeleton className="h-6 w-2/3" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="aspect-[3/4]" />
            <Skeleton className="aspect-[3/4]" />
          </div>
        </div>
      </>
    );
  }

  const myVote = votes.find((v) => v.voterUid === user?.uid);
  const isOwner = user?.uid === post.ownerUid;
  const expired = now > 0 && post.expiresAt <= now;
  const revealTally = Boolean(myVote) || isOwner || expired;
  const tally = tallyVotes(votes, post.candidates.length);
  const totalVotes = tally.reduce((a, b) => a + b, 0);
  const decided = post.decidedCandidateIndex ?? null;
  const leading = totalVotes > 0 ? tally.indexOf(Math.max(...tally)) : null;

  async function handleVote(index: number) {
    if (!user || myVote || expired || isOwner) return;
    setBusy(true);
    try {
      await castVote(postId, index, user.uid);
    } finally {
      setBusy(false);
    }
  }

  async function handleDecide(index: number) {
    if (!isOwner || !post) return;
    setBusy(true);
    try {
      await decideOutfitCandidate(postId, index);
      await markItemsWorn(post.candidates[index]?.itemIds ?? []);
      setPost({ ...post, decidedCandidateIndex: index });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar
        title={isOwner ? "あなたの2択" : `${owner?.name ?? "友達"}の2択`}
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        <div className="mb-4 flex items-center gap-2.5">
          <Avatar src={owner?.avatarUrl} name={owner?.name ?? "友達"} size={38} ring={!isOwner} />
          <div className="min-w-0">
            <p className="text-sm font-bold">{isOwner ? "あなた" : (owner?.name ?? "友達")}</p>
            <p className="text-xs text-muted-foreground">
              {expired ? "投票は終了しました" : isOwner ? "友達の投票を待っています" : "どっちがいいと思う?"}
            </p>
          </div>
        </div>

        {post.mood && <p className="mb-2 rounded-2xl bg-surface-muted px-4 py-3 text-sm">{post.mood}</p>}
        {post.note && <p className="mb-4 text-xs text-muted-foreground">{post.note}</p>}

        <div className="mb-5 grid grid-cols-2 gap-3">
          {post.candidates.map((candidate, index) => {
            const isMyVote = myVote?.candidateIndex === index;
            const isDecided = decided === index;
            const pct = totalVotes > 0 ? Math.round((tally[index] / totalVotes) * 100) : 0;
            const canVote = !isOwner && !myVote && !expired && !busy;

            return (
              <div key={index} className="flex flex-col gap-2">
                <button
                  onClick={() => handleVote(index)}
                  disabled={!canVote}
                  className={`relative overflow-hidden rounded-3xl border-2 text-left transition-transform ${
                    canVote ? "active:scale-[0.98]" : ""
                  } ${isDecided ? "border-accent" : isMyVote ? "border-accent" : "border-border"}`}
                >
                  <OutfitCard candidate={candidate} items={items} faces={faces} className="aspect-[3/4] rounded-none" />

                  {isDecided && (
                    <span className="animate-pop-in absolute left-2 top-2 flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[10px] font-bold text-accent-foreground">
                      <IconCheck className="h-3 w-3" /> これに決めた
                    </span>
                  )}
                  {!isDecided && leading === index && revealTally && totalVotes > 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
                      人気
                    </span>
                  )}

                  <div className="bg-surface p-2 text-center">
                    <p className="text-sm font-bold">候補{index === 0 ? "A" : "B"}</p>
                    {revealTally ? (
                      <p className="text-xs text-muted-foreground">
                        {tally[index]}票{totalVotes > 0 ? ` ・ ${pct}%` : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-accent">タップで投票</p>
                    )}
                  </div>

                  {revealTally && (
                    <div className="h-1 bg-surface-muted">
                      <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </button>

                <OutfitItemChips candidate={candidate} items={items} />

                {isOwner && (
                  <button
                    onClick={() => handleDecide(index)}
                    disabled={busy || isDecided}
                    className={`tappable rounded-full border px-3 py-2 text-xs font-bold ${
                      isDecided
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border-strong bg-surface text-foreground"
                    }`}
                  >
                    {isDecided ? "これを着ました" : "こっちを着る"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {isOwner && decided !== null && (
          <div className="rounded-3xl border border-accent/40 bg-accent-soft p-4">
            <p className="mb-1 text-sm font-bold">着たコーデを記録しましょう</p>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              全身写真を撮って投稿すると、カレンダーに残って、みんなにも見てもらえます。
            </p>
            <Link href={`/post/new?outfit=${post.id}&candidate=${decided}`}>
              <PrimaryButton>
                <span className="inline-flex items-center gap-2">
                  <IconCamera className="h-4 w-4" /> 全身写真を投稿する
                </span>
              </PrimaryButton>
            </Link>
          </div>
        )}

        {isOwner && decided === null && (
          <p className="text-center text-xs text-muted-foreground">
            自分の投稿には投票できません。友達の票を見て「こっちを着る」を選んでください。
          </p>
        )}

        {!isOwner && myVote && (
          <div className="space-y-3">
            <p className="text-center text-xs text-muted-foreground">投票ありがとうございます!</p>
            <Link href="/vote">
              <SecondaryButton>ほかの2択を見る</SecondaryButton>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

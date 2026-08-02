"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { castVote, getOutfitPost, getUserProfile, listClosetItems, tallyVotes, watchVotes } from "@/lib/firestore";
import type { ClosetItem, OutfitPost, UserProfile, Vote } from "@/types/models";
import { IconChevronLeft } from "@/components/icons";

function isExpired(expiresAt: number): boolean {
  return expiresAt <= Date.now();
}

export default function VotePage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<OutfitPost | null>(null);
  const [owner, setOwner] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    getOutfitPost(postId).then(async (p) => {
      setPost(p);
      if (p) {
        setOwner(await getUserProfile(p.ownerUid));
        setItems(await listClosetItems(p.ownerUid));
      }
    });
  }, [postId]);

  useEffect(() => {
    const unsub = watchVotes(postId, setVotes);
    return unsub;
  }, [postId]);

  if (!post) {
    return <p className="mt-10 text-center text-sm text-muted-foreground">読み込み中…</p>;
  }

  const myVote = votes.find((v) => v.voterUid === user?.uid);
  const isOwner = user?.uid === post.ownerUid;
  const expired = isExpired(post.expiresAt);
  const revealTally = Boolean(myVote) || isOwner || expired;
  const tally = tallyVotes(votes, post.candidates.length);
  const totalVotes = tally.reduce((a, b) => a + b, 0);

  async function handleVote(index: number) {
    if (!user || myVote || expired) return;
    setVoting(true);
    try {
      await castVote(postId, index, user.uid);
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-10">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} className="rounded-full p-1.5 hover:bg-surface-muted">
          <IconChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <p className="text-sm font-semibold">{isOwner ? "あなた" : (owner?.name ?? "友達")}の投稿</p>
          <p className="text-xs text-muted-foreground">{expired ? "投票終了" : "どっちがいい?"}</p>
        </div>
      </div>

      <p className="mb-5 rounded-2xl bg-surface-muted px-4 py-3 text-sm">{post.mood}</p>
      {post.note && <p className="mb-5 -mt-3 text-xs text-muted-foreground">{post.note}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3">
        {post.candidates.map((candidate, index) => {
          const candidateItems = candidate.itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is ClosetItem => Boolean(i));
          const isMyVote = myVote?.candidateIndex === index;
          const pct = totalVotes > 0 ? Math.round((tally[index] / totalVotes) * 100) : 0;

          return (
            <button
              key={index}
              onClick={() => handleVote(index)}
              disabled={Boolean(myVote) || expired || voting || isOwner}
              className={`relative overflow-hidden rounded-3xl border-2 text-left transition-transform active:scale-[0.98] disabled:active:scale-100 ${
                isMyVote ? "border-accent" : "border-border"
              }`}
            >
              <div className="relative aspect-[3/4] w-full bg-surface-muted">
                {candidate.composedImageUrl ? (
                  <Image src={candidate.composedImageUrl} alt={`候補${index + 1}`} fill className="object-cover" unoptimized />
                ) : (
                  <div className="grid h-full grid-cols-2 gap-0.5 p-0.5">
                    {candidateItems.map((item) => (
                      <div key={item.id} className="relative overflow-hidden rounded-lg">
                        <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-2 text-center">
                <p className="text-sm font-semibold">候補{index === 0 ? "A" : "B"}</p>
                {revealTally && (
                  <p className="text-xs text-muted-foreground">
                    {tally[index]}票 {totalVotes > 0 && `(${pct}%)`}
                  </p>
                )}
              </div>
              {revealTally && (
                <div className="absolute bottom-0 left-0 h-1 bg-accent transition-all" style={{ width: `${pct}%` }} />
              )}
            </button>
          );
        })}
      </div>

      {isOwner && <p className="text-center text-xs text-muted-foreground">自分の投稿には投票できません。友達の投票を待ちましょう。</p>}
      {!isOwner && myVote && <p className="text-center text-xs text-muted-foreground">投票ありがとうございます!</p>}
    </div>
  );
}

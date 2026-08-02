"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listClosetItems, watchPublicStylePosts } from "@/lib/firestore";
import { recommendHeadline } from "@/lib/recommend";
import type { StylePost } from "@/types/models";
import { StylePostCard } from "@/components/StylePostCard";
import { EmptyState, IconButton, PrimaryButton, Skeleton, TopBar } from "@/components/ui";
import { IconMessage, IconSearch, IconSparkles } from "@/components/icons";

export default function HomeFeedPage() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    const unsub = watchPublicStylePosts(setPosts);
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid).then((items) => setItemCount(items.length));
  }, [user]);

  return (
    <>
      <TopBar
        left={<span className="gradient-text text-xl font-extrabold tracking-tight">My Clothes</span>}
        right={
          <>
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
          <div>
            {posts.map((post) => (
              <StylePostCard key={post.id} post={post} myUid={user?.uid ?? null} />
            ))}
            <p className="py-8 text-center text-xs text-muted-foreground">
              {profile ? "ここまでが最新の投稿です" : ""}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

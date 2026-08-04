"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { listStylePostsByHashtag } from "@/lib/firestore";
import { thumbSrc, type StylePost } from "@/types/models";
import { EmptyState, IconButton, Skeleton, TopBar } from "@/components/ui";
import { IconChevronLeft, IconTag } from "@/components/icons";

/**
 * ハッシュタグのページ。
 *
 * 固定ジャンル(STYLE_GENRES)だけだと運営が決めた語彙しか集まらない。
 * 流行り言葉は利用者の側から生まれるので、自由に付けられるタグで束ねる面を用意している。
 */
export default function HashtagPage() {
  const params = useParams<{ tag: string }>();
  const router = useRouter();
  const tag = decodeURIComponent(params.tag ?? "");

  const [posts, setPosts] = useState<StylePost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStylePostsByHashtag(tag)
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tag]);

  return (
    <>
      <TopBar
        title={`#${tag}`}
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {posts === null ? (
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<IconTag className="h-10 w-10" />}
            title={`#${tag} の投稿はまだありません`}
            description="このタグを付けて最初の1枚を投稿してみましょう。服にタグを登録しておくと、その服を選ぶだけで自動で付きます。"
          />
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{posts.length}件の投稿</p>
            <div className="grid grid-cols-3 gap-1">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/post/${post.id}`}
                  className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface-muted"
                >
                  <Image src={thumbSrc(post)} alt={post.caption || "コーデ"} fill className="object-cover" unoptimized />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

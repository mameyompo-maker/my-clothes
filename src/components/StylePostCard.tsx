"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasLiked, toggleLike } from "@/lib/firestore";
import { SEASONS, STYLE_GENRES, type StylePost } from "@/types/models";
import { Avatar, timeAgo } from "./ui";
import { IconComment, IconHeart, IconHeartFilled, IconTag } from "./icons";

/**
 * 公開タイムラインの1枚。Instagram の投稿カードに、WEAR のアイテムタグを足した形。
 * 写真をタップするとタグの表示/非表示が切り替わる。
 */
export function StylePostCard({ post, myUid }: { post: StylePost; myUid: string | null }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [showTags, setShowTags] = useState(false);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!myUid) return;
    hasLiked(post.id, myUid).then(setLiked);
  }, [post.id, myUid]);

  async function onToggleLike() {
    if (!myUid) return;
    // 先に画面を動かして、通信を待たせない。失敗したら戻す。
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    if (next) {
      setBurst(true);
      setTimeout(() => setBurst(false), 340);
    }
    try {
      await toggleLike(post.id, myUid);
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  }

  const genreLabels = post.genres
    .map((g) => STYLE_GENRES.find((x) => x.value === g)?.label)
    .filter(Boolean) as string[];
  const seasonLabel = SEASONS.find((s) => s.value === post.season);

  return (
    <article className="border-b border-border pb-4">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Link href={`/u/${post.ownerUid}`}>
          <Avatar src={post.ownerAvatarUrl} name={post.ownerName} size={34} ring />
        </Link>
        <Link href={`/u/${post.ownerUid}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{post.ownerName}</p>
          {post.ownerHandle && <p className="truncate text-[11px] text-muted-foreground">@{post.ownerHandle}</p>}
        </Link>
        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
      </div>

      <button
        onClick={() => setShowTags((v) => !v)}
        onDoubleClick={onToggleLike}
        className="relative block w-full bg-surface-muted"
        style={{ aspectRatio: "3 / 4" }}
        aria-label="アイテムタグの表示を切り替える"
      >
        <Image src={post.imageUrl} alt={post.caption || "コーデ"} fill className="object-cover" unoptimized />

        {post.itemTags.length > 0 && (
          <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
            <IconTag className="h-3 w-3" /> {post.itemTags.length}
          </span>
        )}

        {showTags &&
          post.itemTags.map((tag, i) => (
            <span
              key={i}
              className="animate-pop-in absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur"
              style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
            >
              {tag.brand ? `${tag.brand} / ` : ""}
              {tag.label}
            </span>
          ))}

        {burst && (
          <span className="animate-heart pointer-events-none absolute inset-0 flex items-center justify-center">
            <IconHeartFilled className="h-24 w-24 text-white drop-shadow-lg" />
          </span>
        )}
      </button>

      <div className="flex items-center gap-4 px-4 pt-3">
        <button onClick={onToggleLike} className="tappable flex items-center gap-1.5" aria-label="いいね">
          {liked ? (
            <IconHeartFilled className="h-6 w-6 text-accent" />
          ) : (
            <IconHeart className="h-6 w-6" />
          )}
          <span className="text-sm font-semibold">{likeCount > 0 ? likeCount : ""}</span>
        </button>
        <Link href={`/post/${post.id}`} className="tappable flex items-center gap-1.5">
          <IconComment className="h-6 w-6" />
          <span className="text-sm font-semibold">{post.commentCount > 0 ? post.commentCount : ""}</span>
        </Link>
      </div>

      {post.caption && (
        <p className="px-4 pt-2 text-sm leading-relaxed">
          <span className="font-bold">{post.ownerName}</span> {post.caption}
        </p>
      )}

      {(genreLabels.length > 0 || seasonLabel) && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2">
          {seasonLabel && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {seasonLabel.emoji} {seasonLabel.label}
            </span>
          )}
          {genreLabels.map((g) => (
            <span key={g} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              #{g}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

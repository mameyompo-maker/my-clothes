"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasLiked, hasSaved, toggleLike, toggleSave } from "@/lib/firestore";
import { useAuth } from "./AuthProvider";
import { buildOutboundUrl, SEASONS, STYLE_GENRES, type StylePost } from "@/types/models";
import { saveImage, sharePost } from "@/lib/share";
import { Avatar, timeAgo } from "./ui";
import { IconComment, IconHeart, IconHeartFilled, IconTag } from "./icons";

/**
 * 公開タイムラインの1枚。Instagram の投稿カードに、WEAR のアイテムタグを足した形。
 * 写真をタップするとタグの表示/非表示が切り替わる。
 */
export function StylePostCard({ post, myUid }: { post: StylePost; myUid: string | null }) {
  const { profile, likedPostIds, savedPostIds, reactions, setLikedLocal, setSavedLocal } = useAuth();
  // いいね/保存は AuthProvider が起動時に一括で取っている。カードごとに問い合わせると
  // 並んだ枚数ぶん往復が増えるため、ここでは受け取った集合を見るだけにする。
  // 個別に確認するのは、一括取得が**使えないと分かったとき**だけ。読み込み中に
  // 問い合わせてしまうと、結局カードの枚数ぶん往復することになる。
  const bulk = reactions !== "unavailable";
  const [fallbackLiked, setFallbackLiked] = useState(false);
  const [fallbackSaved, setFallbackSaved] = useState(false);
  const liked = bulk ? likedPostIds.has(post.id) : fallbackLiked;
  const saved = bulk ? savedPostIds.has(post.id) : fallbackSaved;
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [showTags, setShowTags] = useState(false);
  const [burst, setBurst] = useState(false);
  const [shareNote, setShareNote] = useState("");

  useEffect(() => {
    if (!myUid || reactions !== "unavailable") return;
    hasLiked(post.id, myUid).then(setFallbackLiked).catch(() => {});
    hasSaved(post.id, myUid).then(setFallbackSaved).catch(() => {});
  }, [post.id, myUid, reactions]);

  function applyLiked(v: boolean) {
    if (bulk) setLikedLocal(post.id, v);
    else setFallbackLiked(v);
  }

  function applySaved(v: boolean) {
    if (bulk) setSavedLocal(post.id, v);
    else setFallbackSaved(v);
  }

  async function onToggleLike() {
    if (!myUid) return;
    // 先に画面を動かして、通信を待たせない。失敗したら戻す。
    const next = !liked;
    applyLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    if (next) {
      setBurst(true);
      setTimeout(() => setBurst(false), 340);
    }
    try {
      await toggleLike(post.id, myUid, profile);
    } catch {
      applyLiked(!next);
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
          {(post.placeName || typeof post.tempC === "number") && (
            <p className="truncate text-[11px] text-muted-foreground">
              {post.placeName ? `📍 ${post.placeName}` : ""}
              {post.placeName && typeof post.tempC === "number" ? " ・ " : ""}
              {typeof post.tempC === "number" ? `🌡 ${Math.round(post.tempC)}℃の日` : ""}
            </p>
          )}
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
          post.itemTags.map((tag, i) => {
            const label = `${tag.brand ? `${tag.brand} / ` : ""}${tag.label}`;
            const href = tag.url ? buildOutboundUrl(tag.url) : null;
            const base =
              "animate-pop-in absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur";
            const style = { left: `${tag.x * 100}%`, top: `${tag.y * 100}%` };

            // リンク付きのタグは、外部サイトへ飛ぶことが分かるようにしてから開く。
            // 写真タップでタグ表示が切り替わるので、ここでは伝播を止める。
            if (href) {
              return (
                <a
                  key={i}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow sponsored"
                  onClick={(e) => e.stopPropagation()}
                  className={`${base} underline decoration-white/50 underline-offset-2`}
                  style={style}
                >
                  {label} ↗
                </a>
              );
            }
            return (
              <span key={i} className={base} style={style}>
                {label}
              </span>
            );
          })}

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

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              if (!myUid) return;
              const next = !saved;
              applySaved(next); // 先に反映して待たせない
              try {
                await toggleSave(post.id, myUid);
              } catch {
                applySaved(!next);
              }
            }}
            className="tappable text-xs font-bold text-accent"
          >
            {saved ? "保存済み" : "保存"}
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await sharePost(post.id, post.caption || "このコーデ見て");
              setShareNote(r === "copied" ? "リンクをコピーしました" : r === "failed" ? "共有できませんでした" : "");
              setTimeout(() => setShareNote(""), 2000);
            }}
            className="tappable text-xs font-bold text-accent"
          >
            共有
          </button>
          <button
            type="button"
            onClick={async () => {
              const r = await saveImage(post.imageUrl, `myclothes-${post.id}.jpg`);
              setShareNote(r === "opened" ? "新しいタブで開きました。長押しで保存できます" : "保存しました");
              setTimeout(() => setShareNote(""), 2500);
            }}
            className="tappable text-xs font-bold text-accent"
          >
            写真を保存
          </button>
        </div>
      </div>

      {shareNote && <p className="px-4 pt-1.5 text-[11px] text-muted-foreground">{shareNote}</p>}

      {post.caption && (
        <p className="px-4 pt-2 text-sm leading-relaxed">
          <span className="font-bold">{post.ownerName}</span> {post.caption}
        </p>
      )}

      {(post.hashtags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1 px-4 pt-2">
          {(post.hashtags ?? []).map((tag) => (
            <Link
              key={tag}
              href={`/tag/${encodeURIComponent(tag)}`}
              className="tappable text-xs font-semibold text-accent"
            >
              #{tag}
            </Link>
          ))}
        </div>
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

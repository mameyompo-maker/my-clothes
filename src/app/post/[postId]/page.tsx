"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addComment, getClosetItemsByIds, getStylePost, updateStylePost, watchComments } from "@/lib/firestore";
import {
  SEASONS,
  STYLE_GENRES,
  type ClosetItem,
  type ItemTag,
  type PostComment,
  type PostVisibility,
  type Season,
  type StyleGenre,
  type StylePost,
} from "@/types/models";
import { StylePostCard } from "@/components/StylePostCard";
import { PricePanel } from "@/components/PricePanel";
import {
  Avatar,
  BottomSheet,
  Chip,
  Field,
  IconButton,
  PrimaryButton,
  Skeleton,
  TopBar,
  inputClass,
  timeAgo,
} from "@/components/ui";
import { IconChevronLeft, IconSend } from "@/components/icons";

export default function StylePostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();

  const [post, setPost] = useState<StylePost | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  // 値段表示に使う、タグ付けされた服の実体。タグは itemId しか持たないため引き直す。
  const [taggedItems, setTaggedItems] = useState<ClosetItem[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);

  const isMine = Boolean(post && user && post.ownerUid === user.uid);

  useEffect(() => {
    getStylePost(postId).then((p) => {
      setPost(p);
      if (!p) setNotFound(true);
      const ids = (p?.itemTags ?? []).map((t) => t.itemId).filter((id): id is string => Boolean(id));
      if (ids.length > 0) getClosetItemsByIds(ids).then(setTaggedItems);
    });
  }, [postId]);

  useEffect(() => watchComments(postId, setComments), [postId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!profile || !body || sending) return;
    setSending(true);
    try {
      await addComment(postId, profile, body);
      setText("");
    } finally {
      setSending(false);
    }
  }

  if (notFound) {
    return (
      <>
        <TopBar
          title="投稿"
          left={
            <IconButton label="戻る" onClick={() => router.back()}>
              <IconChevronLeft className="h-5 w-5" />
            </IconButton>
          }
        />
        <p className="mt-12 text-center text-sm text-muted-foreground">この投稿は見つかりませんでした。</p>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="投稿"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
        right={
          isMine ? (
            <button onClick={() => setEditing(true)} className="text-sm font-bold text-accent">
              編集
            </button>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-lg pb-32">
        {post ? (
          <StylePostCard post={post} myUid={user?.uid ?? null} />
        ) : (
          <div className="px-4 pt-4">
            <Skeleton className="h-[420px]" />
          </div>
        )}

        {post && taggedItems.length > 0 && (
          <div className="px-4 pt-3">
            <PricePanel postId={post.id} ownerUid={post.ownerUid} groups={[{ title: null, items: taggedItems }]} />
          </div>
        )}

        <section className="px-4 pt-4">
          <h2 className="mb-3 text-sm font-bold">コメント {comments.length > 0 && `(${comments.length})`}</h2>
          {comments.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              まだコメントはありません。最初のひとことを送ってみましょう。
            </p>
          ) : (
            <ul className="space-y-3.5">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar src={c.avatarUrl} name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed">
                      <span className="font-bold">{c.name}</span>{" "}
                      <span className="whitespace-pre-wrap break-words">{c.text}</span>
                    </p>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <form
        onSubmit={handleSend}
        className="fixed bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          {profile && <Avatar src={profile.avatarUrl} name={profile.name} size={32} />}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="コメントを追加…"
            className={`${inputClass} flex-1 py-2.5`}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="送信"
            className="tappable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
          >
            <IconSend className="h-4 w-4" />
          </button>
        </div>
      </form>

      <BottomSheet open={editing && Boolean(post)} onClose={() => setEditing(false)} title="投稿を編集">
        {post && (
          <EditPostForm
            post={post}
            onSaved={(patch) => {
              setPost({ ...post, ...patch });
              setEditing(false);
            }}
          />
        )}
      </BottomSheet>
    </>
  );
}

/**
 * 投稿の編集。写真だけは差し替えられない。
 * いいねが付いたあとに中身をすり替えられると、反応の意味が変わってしまうため。
 */
function EditPostForm({
  post,
  onSaved,
}: {
  post: StylePost;
  onSaved: (patch: Partial<StylePost>) => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [visibility, setVisibility] = useState<PostVisibility>(post.visibility);
  const [genres, setGenres] = useState<StyleGenre[]>(post.genres);
  const [season, setSeason] = useState<Season | null>(post.season);
  const [placeName, setPlaceName] = useState(post.placeName ?? "");
  const [itemTags, setItemTags] = useState<ItemTag[]>(post.itemTags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleGenre(value: StyleGenre) {
    setGenres((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const patch = {
      caption: caption.trim(),
      visibility,
      genres,
      season,
      placeName: placeName.trim() || null,
      itemTags,
    };
    try {
      await updateStylePost(post.id, patch);
      onSaved(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
      setSaving(false);
    }
  }

  return (
    <div className="pb-4">
      <Field label="キャプション">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field label="公開範囲">
        <div className="flex gap-2">
          <Chip selected={visibility === "public"} onClick={() => setVisibility("public")}>
            みんなに公開
          </Chip>
          <Chip selected={visibility === "friends"} onClick={() => setVisibility("friends")}>
            友達だけ
          </Chip>
        </div>
      </Field>

      <Field label="場所" hint="市区町村まで。空欄にすると場所を消せます。">
        <input
          value={placeName}
          onChange={(e) => setPlaceName(e.target.value)}
          maxLength={40}
          className={inputClass}
        />
      </Field>

      <Field label="ジャンル">
        <div className="flex flex-wrap gap-2">
          {STYLE_GENRES.map((g) => (
            <Chip key={g.value} size="sm" selected={genres.includes(g.value)} onClick={() => toggleGenre(g.value)}>
              {g.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="季節">
        <div className="flex flex-wrap gap-2">
          {SEASONS.map((s) => (
            <Chip
              key={s.value}
              size="sm"
              selected={season === s.value}
              onClick={() => setSeason(season === s.value ? null : s.value)}
            >
              {s.emoji} {s.label}
            </Chip>
          ))}
        </div>
      </Field>

      {itemTags.length > 0 && (
        <Field label="タグの購入リンク" hint="ブランドの商品ページなどを入れると、見た人がタップして飛べます。">
          <div className="space-y-2">
            {itemTags.map((tag, i) => (
              <div key={i}>
                <p className="mb-1 truncate text-[11px] font-semibold text-muted-foreground">
                  {tag.brand ? `${tag.brand} / ` : ""}
                  {tag.label}
                </p>
                <input
                  value={tag.url ?? ""}
                  onChange={(e) =>
                    setItemTags((prev) => prev.map((t, idx) => (idx === i ? { ...t, url: e.target.value } : t)))
                  }
                  inputMode="url"
                  placeholder="https://..."
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </Field>
      )}

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <PrimaryButton onClick={handleSave} disabled={saving}>
        {saving ? "保存しています…" : "保存する"}
      </PrimaryButton>
    </div>
  );
}

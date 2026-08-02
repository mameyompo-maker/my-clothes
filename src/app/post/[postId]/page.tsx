"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addComment, getStylePost, watchComments } from "@/lib/firestore";
import type { PostComment, StylePost } from "@/types/models";
import { StylePostCard } from "@/components/StylePostCard";
import { Avatar, IconButton, Skeleton, TopBar, inputClass, timeAgo } from "@/components/ui";
import { IconChevronLeft, IconSend } from "@/components/icons";

export default function StylePostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();

  const [post, setPost] = useState<StylePost | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getStylePost(postId).then((p) => {
      setPost(p);
      if (!p) setNotFound(true);
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
      />

      <div className="mx-auto max-w-lg pb-32">
        {post ? (
          <StylePostCard post={post} myUid={user?.uid ?? null} />
        ) : (
          <div className="px-4 pt-4">
            <Skeleton className="h-[420px]" />
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
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-xl"
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
    </>
  );
}

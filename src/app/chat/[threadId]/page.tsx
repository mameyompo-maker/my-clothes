"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  getUserProfile,
  markChatThreadRead,
  sendChatMessage,
  uploadImage,
  watchChatMessages,
  watchChatThread,
} from "@/lib/firestore";
import { compressImage } from "@/lib/image";
import type { ChatMessage, ChatThread, UserProfile } from "@/types/models";
import { Avatar, IconButton, TopBar, inputClass } from "@/components/ui";
import { IconCamera, IconChevronLeft, IconSend, IconX } from "@/components/icons";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** その日の0時の時刻。日付が変わったかの判定に使う。 */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(ms: number): string {
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000);
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function ChatThreadPage() {
  const params = useParams<{ threadId: string }>();
  const id = params.threadId;
  const router = useRouter();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [other, setOther] = useState<UserProfile | null>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    return watchChatMessages(id, setMessages);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return watchChatThread(id, setThread);
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    // スレッドIDは参加者2人のUIDをソートして繋いだもの。自分でない方が相手。
    const otherUid = id.split("__").find((u) => u !== user.uid);
    if (otherUid) getUserProfile(otherUid).then(setOther);
  }, [id, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // 相手からのメッセージを画面に出した時点で既読にする。
  // 失敗しても会話は成立するので投げっぱなしでよい。
  useEffect(() => {
    if (!id || !user || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.senderUid !== user.uid) void markChatThreadRead(id, user.uid).catch(() => {});
  }, [id, user, messages]);

  function selectPhoto(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    const photoToSend = photo;
    if (!user || (!body && !photoToSend) || sending) return;
    setSending(true);
    setText("");
    try {
      let imageUrl: string | null = null;
      if (photoToSend) {
        const compressed = await compressImage(photoToSend);
        imageUrl = await uploadImage(`chat/${user.uid}/${crypto.randomUUID()}.jpg`, compressed);
      }
      await sendChatMessage(id, user.uid, body, imageUrl);
      selectPhoto(null);
    } catch {
      setText(body); // 送信に失敗したら書いた内容を戻す(写真の選択もそのまま残る)
    } finally {
      setSending(false);
    }
  }

  const otherUid = id?.split("__").find((u) => u !== user?.uid) ?? "";
  const otherReadAt = thread?.lastReadAt?.[otherUid] ?? 0;
  // 既読ラベルは「既読になっている自分の最新メッセージ」1件だけに出す。
  // 全件に付けると画面が「既読」だらけになるため。
  const lastReadMineId =
    [...messages].reverse().find((m) => m.senderUid === user?.uid && m.createdAt <= otherReadAt)?.id ?? null;

  return (
    <>
      <TopBar
        left={
          <div className="flex items-center gap-2">
            <IconButton label="戻る" onClick={() => router.back()}>
              <IconChevronLeft className="h-5 w-5" />
            </IconButton>
            <Avatar src={other?.avatarUrl} name={other?.name ?? "友達"} size={32} />
            <span className="truncate text-sm font-bold">{other?.name ?? "友達"}</span>
          </div>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-36 pt-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            メッセージを送ってみましょう。「今日どっちがいいと思う?」から始めるのもおすすめです。
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m, i) => {
              const mine = m.senderUid === user?.uid;
              const showDay = i === 0 || startOfDay(messages[i - 1].createdAt) !== startOfDay(m.createdAt);
              const meta = (
                <span
                  className={`flex shrink-0 flex-col self-end pb-0.5 text-[10px] leading-tight text-muted-foreground ${
                    mine ? "items-end" : "items-start"
                  }`}
                >
                  {mine && m.id === lastReadMineId && <span>既読</span>}
                  <span>{formatTime(m.createdAt)}</span>
                </span>
              );
              return (
                <li key={m.id}>
                  {showDay && (
                    <div className="flex justify-center py-3">
                      <span className="rounded-full bg-surface-muted px-3 py-1 text-[10px] text-muted-foreground">
                        {dayLabel(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className={`flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
                    {mine && meta}
                    <div className={`max-w-[76%] ${mine ? "flex flex-col items-end" : ""}`}>
                      {m.imageUrl && (
                        <a href={m.imageUrl} target="_blank" rel="noreferrer" className="tappable block">
                          <Image
                            src={m.imageUrl}
                            alt="送信された写真"
                            width={480}
                            height={480}
                            unoptimized
                            className={`h-auto w-full max-w-[240px] rounded-3xl border border-border object-cover ${
                              m.text ? "mb-1" : ""
                            } ${mine ? "rounded-br-md" : "rounded-bl-md"}`}
                          />
                        </a>
                      )}
                      {m.text && (
                        <div
                          className={`whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-sm ${
                            mine
                              ? "rounded-br-md bg-accent text-accent-foreground"
                              : "rounded-bl-md bg-surface-muted text-foreground"
                          }`}
                        >
                          {m.text}
                        </div>
                      )}
                    </div>
                    {!mine && meta}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="fixed bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] left-0 right-0 z-30 border-t border-border bg-background/95 px-4 pb-3 pt-3 backdrop-blur-xl"
      >
        <div className="mx-auto max-w-lg">
          {photoPreview && (
            <div className="mb-2 flex items-center gap-2">
              <span className="relative h-16 w-16 overflow-hidden rounded-xl border border-border">
                <Image src={photoPreview} alt="送信する写真" fill unoptimized className="object-cover" />
              </span>
              <button
                type="button"
                onClick={() => selectPhoto(null)}
                aria-label="写真を取り消す"
                className="tappable flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* capture は意図的に付けない。付けるとカメラが直接起動し、保存済みの写真を選べなくなる。 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                selectPhoto(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="写真を添付"
              className="tappable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground disabled:opacity-40"
            >
              <IconCamera className="h-5 w-5" />
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="メッセージ…"
              className={`${inputClass} flex-1 py-2.5`}
            />
            <button
              type="submit"
              disabled={(!text.trim() && !photo) || sending}
              aria-label="送信"
              className="tappable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
            >
              <IconSend className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

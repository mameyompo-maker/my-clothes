"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getUserProfile, sendChatMessage, watchChatMessages } from "@/lib/firestore";
import type { ChatMessage, UserProfile } from "@/types/models";
import { Avatar, IconButton, TopBar, inputClass } from "@/components/ui";
import { IconChevronLeft, IconSend } from "@/components/icons";

export default function ChatThreadPage() {
  const params = useParams<{ threadId: string }>();
  const id = params.threadId;
  const router = useRouter();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [other, setOther] = useState<UserProfile | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    return watchChatMessages(id, setMessages);
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!user || !body || sending) return;
    setSending(true);
    setText("");
    try {
      await sendChatMessage(id, user.uid, body);
    } catch {
      setText(body); // 送信に失敗したら書いた内容を戻す
    } finally {
      setSending(false);
    }
  }

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

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            メッセージを送ってみましょう。「今日どっちがいいと思う?」から始めるのもおすすめです。
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => {
              const mine = m.senderUid === user?.uid;
              return (
                <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[76%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-sm ${
                      mine
                        ? "rounded-br-md bg-accent text-accent-foreground"
                        : "rounded-bl-md bg-surface-muted text-foreground"
                    }`}
                  >
                    {m.text}
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
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="メッセージ…"
            className={`${inputClass} flex-1 py-2.5`}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="送信"
            className="tappable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
          >
            <IconSend className="h-4 w-4" />
          </button>
        </div>
      </form>
    </>
  );
}

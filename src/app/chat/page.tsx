"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ensureChatThread, getFriendProfiles, watchChatThreads } from "@/lib/firestore";
import { threadId, type ChatThread, type UserProfile } from "@/types/models";
import { Avatar, EmptyState, IconButton, Skeleton, TopBar, timeAgo } from "@/components/ui";
import { IconChevronLeft, IconMessage } from "@/components/icons";

export default function ChatListPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchChatThreads(user.uid, setThreads);
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    getFriendProfiles(profile.friendUids).then(setFriends);
  }, [profile]);

  async function openWith(friendUid: string) {
    if (!user) return;
    setStarting(friendUid);
    try {
      await ensureChatThread(user.uid, friendUid);
      router.push(`/chat/${threadId(user.uid, friendUid)}`);
    } finally {
      setStarting(null);
    }
  }

  const friendByUid = Object.fromEntries(friends.map((f) => [f.uid, f]));

  return (
    <>
      <TopBar
        title="メッセージ"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {friends.length === 0 ? (
          <EmptyState
            icon={<IconMessage className="h-10 w-10" />}
            title="まだ友達がいません"
            description="招待コードで友達を追加すると、ここでやりとりできます。"
            action={
              <Link href="/profile" className="text-sm font-bold text-accent">
                友達を追加する →
              </Link>
            }
          />
        ) : (
          <>
            <h2 className="mb-3 text-sm font-bold">友達</h2>
            <div className="no-scrollbar -mx-4 mb-6 flex gap-4 overflow-x-auto px-4">
              {friends.map((f) => (
                <button
                  key={f.uid}
                  onClick={() => openWith(f.uid)}
                  disabled={starting === f.uid}
                  className="tappable flex w-16 shrink-0 flex-col items-center gap-1.5"
                >
                  <Avatar src={f.avatarUrl} name={f.name} size={56} ring />
                  <span className="w-full truncate text-center text-[11px]">{f.name}</span>
                </button>
              ))}
            </div>

            <h2 className="mb-3 text-sm font-bold">やりとり</h2>
            {threads === null ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : threads.filter((t) => t.lastMessage).length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                まだメッセージがありません。上の友達をタップして始めましょう。
              </p>
            ) : (
              <ul className="space-y-1">
                {threads
                  .filter((t) => t.lastMessage)
                  .map((t) => {
                    const otherUid = t.memberUids.find((u) => u !== user?.uid) ?? "";
                    const other = friendByUid[otherUid];
                    return (
                      <li key={t.id}>
                        <Link
                          href={`/chat/${t.id}`}
                          className="tappable flex items-center gap-3 rounded-2xl px-2 py-2.5"
                        >
                          <Avatar src={other?.avatarUrl} name={other?.name ?? "友達"} size={50} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">{other?.name ?? "友達"}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {t.lastSenderUid === user?.uid ? "あなた: " : ""}
                              {t.lastMessage}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {timeAgo(t.lastMessageAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

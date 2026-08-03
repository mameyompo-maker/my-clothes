"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ensureChatThread, getFriendProfiles, listFollowingUids, watchChatThreads } from "@/lib/firestore";
import { threadId, type ChatThread, type UserProfile } from "@/types/models";
import { Avatar, EmptyState, IconButton, Skeleton, TopBar, timeAgo } from "@/components/ui";
import { IconChevronLeft, IconMessage } from "@/components/icons";

export default function ChatListPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [contacts, setContacts] = useState<UserProfile[]>([]);
  const [peopleByUid, setPeopleByUid] = useState<Record<string, UserProfile>>({});
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchChatThreads(user.uid, setThreads);
  }, [user]);

  // 送れる相手 = 友達(相互フォロー)+ 自分がフォローしている人。
  // 友達だけに絞ると、フォローした直後に誰にも送れず「使えない」ように見えるため広めに取る。
  useEffect(() => {
    if (!profile || !user) return;
    let cancelled = false;
    (async () => {
      const followingUids = await listFollowingUids(user.uid);
      const uids = Array.from(new Set([...(profile.friendUids ?? []), ...followingUids]));
      const people = await getFriendProfiles(uids);
      if (cancelled) return;
      setContacts(people);
      setPeopleByUid(Object.fromEntries(people.map((p) => [p.uid, p])));
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, user]);

  // スレッド相手が contacts に居ない場合(フォローを外した後など)も名前を出せるよう補完する。
  useEffect(() => {
    if (!threads || !user) return;
    const missing = threads
      .map((t) => t.memberUids.find((u) => u !== user.uid))
      .filter((u): u is string => typeof u === "string" && !peopleByUid[u]);
    if (missing.length === 0) return;
    let cancelled = false;
    getFriendProfiles(Array.from(new Set(missing))).then((people) => {
      if (cancelled || people.length === 0) return;
      setPeopleByUid((prev) => ({ ...prev, ...Object.fromEntries(people.map((p) => [p.uid, p])) }));
    });
    return () => {
      cancelled = true;
    };
  }, [threads, user, peopleByUid]);

  async function openWith(otherUid: string) {
    if (!user) return;
    setStarting(otherUid);
    try {
      await ensureChatThread(user.uid, otherUid);
      router.push(`/chat/${threadId(user.uid, otherUid)}`);
    } finally {
      setStarting(null);
    }
  }

  const activeThreads = (threads ?? []).filter((t) => t.lastMessage);

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
        {contacts.length === 0 && activeThreads.length === 0 ? (
          <EmptyState
            icon={<IconMessage className="h-10 w-10" />}
            title="まだ送れる相手がいません"
            description="招待コードで友達を追加するか、気になる人をフォローすると、ここからメッセージを送れます。"
            action={
              <Link href="/search" className="text-sm font-bold text-accent">
                ユーザーをさがす →
              </Link>
            }
          />
        ) : (
          <>
            {contacts.length > 0 && (
              <>
                <h2 className="mb-3 text-sm font-bold">送る相手</h2>
                <div className="no-scrollbar -mx-4 mb-6 flex gap-4 overflow-x-auto px-4">
                  {contacts.map((c) => (
                    <button
                      key={c.uid}
                      onClick={() => openWith(c.uid)}
                      disabled={starting === c.uid}
                      className="tappable flex w-16 shrink-0 flex-col items-center gap-1.5 disabled:opacity-50"
                    >
                      <Avatar src={c.avatarUrl} name={c.name} size={56} ring />
                      <span className="w-full truncate text-center text-[11px]">{c.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <h2 className="mb-3 text-sm font-bold">やりとり</h2>
            {threads === null ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : activeThreads.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                まだメッセージがありません。上のアイコンをタップして始めましょう。
              </p>
            ) : (
              <ul className="space-y-1">
                {activeThreads.map((t) => {
                  const otherUid = t.memberUids.find((u) => u !== user?.uid) ?? "";
                  const other = peopleByUid[otherUid];
                  // 相手が最後に送ってきた後、自分がまだスレッドを開いていなければ未読。
                  const myReadAt = t.lastReadAt?.[user?.uid ?? ""] ?? 0;
                  const unread = t.lastSenderUid !== null && t.lastSenderUid !== user?.uid && t.lastMessageAt > myReadAt;
                  return (
                    <li key={t.id}>
                      <Link href={`/chat/${t.id}`} className="tappable flex items-center gap-3 rounded-2xl px-2 py-2.5">
                        <Avatar src={other?.avatarUrl} name={other?.name ?? "ユーザー"} size={50} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{other?.name ?? "ユーザー"}</p>
                          <p
                            className={`truncate text-xs ${
                              unread ? "font-bold text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {t.lastSenderUid === user?.uid ? "あなた: " : ""}
                            {t.lastMessage}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[11px] text-muted-foreground">{timeAgo(t.lastMessageAt)}</span>
                          {unread && <span aria-label="未読あり" className="h-2.5 w-2.5 rounded-full bg-accent" />}
                        </div>
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

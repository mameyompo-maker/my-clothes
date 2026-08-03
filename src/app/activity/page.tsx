"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { markNotificationsRead, watchNotifications } from "@/lib/firestore";
import type { AppNotification } from "@/types/models";
import { Avatar, EmptyState, IconButton, Skeleton, TopBar, timeAgo } from "@/components/ui";
import { IconChevronLeft, IconHeart } from "@/components/icons";

/**
 * アクティビティ(通知)。
 *
 * 開いた時点で既読にする。個別の既読状態は持たず「どこまで読んだか」の時刻だけで
 * 数えているので、書き込みは1回で済む。
 */
export default function ActivityPage() {
  const { user, profile, hiddenUids, refreshProfile } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[] | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchNotifications(user.uid, setItems);
  }, [user]);

  useEffect(() => {
    if (!user || !items) return;
    // 開いたら既読。少し遅らせるのは、未読の見え方を一瞬だけ残して
    // 「何が新しかったか」を認識できるようにするため。
    const timer = setTimeout(() => {
      void markNotificationsRead(user.uid).then(refreshProfile);
    }, 1200);
    return () => clearTimeout(timer);
  }, [user, items, refreshProfile]);

  const lastRead = profile?.lastReadNotificationAt ?? 0;
  const visible = (items ?? []).filter((n) => !hiddenUids.has(n.actorUid));

  return (
    <>
      <TopBar
        title="アクティビティ"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {items === null ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<IconHeart className="h-10 w-10" />}
            title="まだお知らせはありません"
            description="いいね・コメント・フォロー・2択への投票があると、ここに届きます。"
          />
        ) : (
          <ul className="space-y-1">
            {visible.map((n) => {
              const unread = n.createdAt > lastRead;
              const href = n.postId ? `/post/${n.postId}` : `/u/${n.actorUid}`;
              return (
                <li key={n.id}>
                  <Link
                    href={href}
                    className={`tappable flex items-center gap-3 rounded-2xl px-3 py-3 ${
                      unread ? "bg-accent-soft" : ""
                    }`}
                  >
                    <Avatar src={n.actorAvatarUrl} name={n.actorName} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{n.text}</p>
                      <span className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </div>
                    {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

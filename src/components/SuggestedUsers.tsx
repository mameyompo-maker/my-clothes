"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { followUser, suggestUsersToFollow } from "@/lib/firestore";
import { cachedOnce, invalidateOnce } from "@/lib/liveStore";
import type { UserProfile } from "@/types/models";
import { Avatar, VerifiedBadge } from "./ui";

/** おすすめを作り直すまでの時間。ホームを開くたびに引き直す必要はない。 */
const SUGGEST_TTL_MS = 10 * 60 * 1000;

/**
 * 「おすすめの人」。
 *
 * 誰ともつながっていない人のフィードは空同然で、初日の離脱を生む。ここで出すのは
 * 骨格タイプ・パーソナルカラー・身長・好きなジャンルが近い人。**なぜおすすめなのかを
 * 必ず添える**のが肝で、理由の無い推薦はフォローされないし、気味も悪い。
 */
export function SuggestedUsers({ compact = false }: { compact?: boolean }) {
  const { user, profile, hiddenUids, followingUids, refreshProfile, refreshFollowing } = useAuth();
  const [items, setItems] = useState<{ profile: UserProfile; reason: string }[] | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  // 依存はすべて**文字列にしてから**渡す。profile や Set をそのまま依存に置くと、
  // 中身が同じでも参照が変わるたびに再取得が走り、ホームを開くたび何度も
  // ユーザー一覧を読み直すことになる(ここが重かった原因のひとつ)。
  // フォロー中の人はここで**取得後に**外す。取得条件に混ぜるとフォローするたび
  // キャッシュキーが変わって引き直しになるため。
  const myUid = profile?.uid ?? null;
  const hiddenKey = Array.from(hiddenUids).sort().join(",");

  useEffect(() => {
    if (!profile || !myUid) return;
    let cancelled = false;
    void cachedOnce(`suggest:${myUid}:${hiddenKey}`, SUGGEST_TTL_MS, () =>
      suggestUsersToFollow(profile, Array.from(hiddenUids))
    )
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // profile 全体ではなく uid と除外キーだけを見る(上のコメントの理由)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, hiddenKey]);

  async function handleFollow(targetUid: string) {
    if (!user) return;
    // 先に画面を動かす。フォローは失敗しても致命的ではないので、待たせない。
    setFollowed((prev) => new Set(prev).add(targetUid));
    try {
      await followUser(user.uid, targetUid, profile);
      invalidateOnce("suggest");
      await Promise.all([refreshProfile(), refreshFollowing()]);
    } catch {
      setFollowed((prev) => {
        const next = new Set(prev);
        next.delete(targetUid);
        return next;
      });
    }
  }

  const shown = (items ?? []).filter((x) => !followingUids.includes(x.profile.uid));
  if (shown.length === 0) return null;

  return (
    <section className={compact ? "" : "mb-5"}>
      <h2 className="mb-2 text-sm font-bold">おすすめの人</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        骨格タイプや好きなジャンルが近い人を選んでいます。似た体型の人の着こなしは、そのまま真似できます。
      </p>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
        {shown.map(({ profile: u, reason }) => (
          <div
            key={u.uid}
            className="w-36 shrink-0 rounded-3xl border border-border bg-surface p-3 text-center"
          >
            <Link href={`/u/${u.uid}`} className="block">
              <div className="mx-auto mb-2 w-fit">
                <Avatar src={u.avatarUrl} name={u.name} size={56} />
              </div>
              <p className="flex items-center justify-center gap-1 truncate text-xs font-bold">
                <span className="truncate">{u.name}</span>
                {u.official && <VerifiedBadge size={12} />}
              </p>
              <p className="mt-0.5 line-clamp-2 h-7 text-[10px] leading-snug text-muted-foreground">{reason}</p>
            </Link>
            <button
              type="button"
              onClick={() => handleFollow(u.uid)}
              disabled={followed.has(u.uid)}
              className={`tappable mt-2 w-full rounded-full px-3 py-1.5 text-[11px] font-bold ${
                followed.has(u.uid)
                  ? "border border-border text-muted-foreground"
                  : "bg-accent text-accent-foreground"
              }`}
            >
              {followed.has(u.uid) ? "フォロー中" : "フォロー"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { searchUsersByHandle, watchPublicStylePosts } from "@/lib/firestore";
import { STYLE_GENRES, type StyleGenre, type StylePost, type UserProfile } from "@/types/models";
import { Avatar, Chip, EmptyState, IconButton, Skeleton, TopBar, inputClass } from "@/components/ui";
import { IconChevronLeft, IconSearch } from "@/components/icons";

export default function SearchPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  const [genre, setGenre] = useState<StyleGenre | null>(null);

  useEffect(() => watchPublicStylePosts(setPosts), []);

  useEffect(() => {
    if (!user) return;
    const trimmed = term.trim();
    // 打つたびに叩かず、少し待ってからまとめて検索する。
    // setState はすべてタイマーのコールバック内で行い、effect 本体からは呼ばない。
    const timer = setTimeout(() => {
      if (!trimmed) {
        setUsers([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchUsersByHandle(trimmed, user.uid)
        .then(setUsers)
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [term, user]);

  const filteredPosts = (posts ?? []).filter((p) => !genre || p.genres.includes(genre));

  return (
    <>
      <TopBar
        title="さがす"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg pb-28">
        <div className="px-4 pt-4">
          <div className="relative mb-4">
            <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="ユーザーネームで検索(@なしでOK)"
              className={`${inputClass} pl-10`}
            />
          </div>

          {term.trim() && (
            <div className="mb-6">
              {searching ? (
                <Skeleton className="h-14" />
              ) : users.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  見つかりませんでした。ユーザーネームの先頭から入力してください。
                </p>
              ) : (
                <ul className="space-y-1">
                  {users.map((u) => (
                    <li key={u.uid}>
                      <Link
                        href={`/u/${u.uid}`}
                        className="tappable flex items-center gap-3 rounded-2xl px-2 py-2.5"
                      >
                        <Avatar src={u.avatarUrl} name={u.name} size={44} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{u.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">@{u.handle}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {u.followerCount ?? 0} フォロワー
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {STYLE_GENRES.map((g) => (
              <Chip
                key={g.value}
                size="sm"
                selected={genre === g.value}
                onClick={() => setGenre(genre === g.value ? null : g.value)}
              >
                {g.label}
              </Chip>
            ))}
          </div>
        </div>

        {posts === null ? (
          <div className="grid grid-cols-3 gap-[2px]">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-none" />
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="px-4">
            <EmptyState
              title={genre ? "このジャンルの投稿はまだありません" : "まだ公開投稿がありません"}
              description="最初の1枚を投稿すると、ここに並びます。"
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[2px]">
            {filteredPosts.map((p) => (
              <Link key={p.id} href={`/post/${p.id}`} className="relative aspect-square bg-surface-muted">
                <Image src={p.imageUrl} alt={p.caption || "投稿"} fill className="object-cover" unoptimized />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

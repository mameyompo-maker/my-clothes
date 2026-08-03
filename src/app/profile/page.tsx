"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  addFacePattern,
  getFriendProfiles,
  listFacePatterns,
  listUserStylePosts,
  MAX_FACE_PATTERNS,
  redeemInviteCode,
  updateUserProfile,
} from "@/lib/firestore";
import { compressImage } from "@/lib/image";
import {
  BODY_TYPES,
  MAX_FAVORITE_POSTS,
  PERSONAL_COLORS,
  STYLE_GENRES,
  type FacePattern,
  type StylePost,
  type UserProfile,
} from "@/types/models";
import {
  Avatar,
  BottomSheet,
  EmptyState,
  Field,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  TopBar,
  inputClass,
  VerifiedBadge,
} from "@/components/ui";
import {
  IconCalendar,
  IconCamera,
  IconCheck,
  IconGrid,
  IconSettings,
  IconUsers,
} from "@/components/icons";

export default function ProfilePage() {
  const { user, profile, signOutUser, refreshProfile } = useAuth();
  const [faces, setFaces] = useState<FacePattern[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [posts, setPosts] = useState<StylePost[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [addState, setAddState] = useState<
    { kind: "idle" } | { kind: "adding" } | { kind: "added"; name: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [friendSheet, setFriendSheet] = useState(false);
  const [faceSheet, setFaceSheet] = useState(false);
  const [favSheet, setFavSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const favoriteIds = profile?.favoritePostIds ?? [];
  const favoritePosts = (posts ?? []).filter((p) => favoriteIds.includes(p.id));

  async function toggleFavorite(postId: string) {
    if (!user) return;
    const next = favoriteIds.includes(postId)
      ? favoriteIds.filter((id) => id !== postId)
      : [...favoriteIds, postId].slice(-MAX_FAVORITE_POSTS);
    await updateUserProfile(user.uid, { favoritePostIds: next });
    await refreshProfile();
  }

  useEffect(() => {
    if (!user) return;
    listFacePatterns(user.uid).then(setFaces);
    listUserStylePosts(user.uid).then(setPosts);
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    getFriendProfiles(profile.friendUids).then(setFriends);
  }, [profile]);

  const inviteUrl = profile
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/onboarding?invite=${profile.inviteCode}`
    : "";

  function copyWithFallback(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }

  async function copyInviteLink() {
    if (!inviteUrl) return;
    setCopyError(false);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
      } else if (!copyWithFallback(inviteUrl)) {
        throw new Error("copy failed");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (copyWithFallback(inviteUrl)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setCopyError(true);
      }
    }
  }

  async function handleAddFriend(e: React.FormEvent) {
    e.preventDefault();
    const entered = friendCode.trim().toUpperCase();
    if (!user || !entered || addState.kind === "adding") return;
    setAddState({ kind: "adding" });
    try {
      const { friendName } = await redeemInviteCode(user.uid, entered);
      await refreshProfile();
      setFriendCode("");
      setAddState({ kind: "added", name: friendName });
    } catch (err) {
      setAddState({ kind: "error", message: err instanceof Error ? err.message : "友達の追加に失敗しました。" });
    }
  }

  async function handleAddFace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const created = await addFacePattern(user.uid, `パターン${faces.length + 1}`, compressed);
      setFaces((prev) => [...prev, created]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!user || !profile) {
    return (
      <>
        <TopBar title="マイページ" />
        <div className="mx-auto max-w-lg space-y-4 px-4 pt-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      </>
    );
  }

  const bodyType = BODY_TYPES.find((b) => b.value === (profile.bodyType ?? "unknown"));
  const personalColor = PERSONAL_COLORS.find((p) => p.value === (profile.personalColor ?? "unknown"));
  const favoriteGenres = (profile.favoriteGenres ?? [])
    .map((g) => STYLE_GENRES.find((x) => x.value === g)?.label)
    .filter(Boolean);

  return (
    <>
      <TopBar
        left={
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-lg font-bold tracking-tight">{profile.name}</span>
            {profile.official && <VerifiedBadge size={16} />}
          </span>
        }
        right={
          <>
            <Link href="/calendar" aria-label="カレンダー">
              <IconButton label="カレンダー">
                <IconCalendar className="h-5 w-5" />
              </IconButton>
            </Link>
            <Link href="/profile/edit" aria-label="設定">
              <IconButton label="設定">
                <IconSettings className="h-5 w-5" />
              </IconButton>
            </Link>
          </>
        }
      />

      <div className="mx-auto max-w-lg pb-28">
        <div className="px-4 pt-5">
          <div className="mb-4 flex items-center gap-5">
            <Avatar src={profile.avatarUrl} name={profile.name} size={78} ring />
            <div className="grid flex-1 grid-cols-3 text-center">
              <Stat value={posts?.length ?? 0} label="投稿" />
              <Stat value={profile.followerCount ?? 0} label="フォロワー" />
              <Stat value={profile.followingCount ?? 0} label="フォロー中" />
            </div>
          </div>

          <div className="mb-3">
            {profile.handle && <p className="text-xs text-muted-foreground">@{profile.handle}</p>}
            {profile.bio && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{profile.bio}</p>}
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {profile.height ? <Tag>{profile.height}cm</Tag> : null}
            {bodyType && bodyType.value !== "unknown" && <Tag>骨格{bodyType.label}</Tag>}
            {personalColor && personalColor.value !== "unknown" && <Tag>{personalColor.label}</Tag>}
            {profile.sizeTops && <Tag>トップス {profile.sizeTops}</Tag>}
            {profile.sizeBottoms && <Tag>ボトムス {profile.sizeBottoms}</Tag>}
            {profile.sizeShoes && <Tag>靴 {profile.sizeShoes}</Tag>}
            {favoriteGenres.map((g) => (
              <Tag key={g}>#{g}</Tag>
            ))}
          </div>

          <div className="mb-5 flex gap-2">
            <Link href="/profile/edit" className="flex-1">
              <SecondaryButton>プロフィールを編集</SecondaryButton>
            </Link>
            <button
              onClick={() => setFriendSheet(true)}
              className="tappable flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold"
            >
              <IconUsers className="h-4 w-4" />
              {friends.length}
            </button>
          </div>

          <div className="mb-5 rounded-3xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">あなたの招待コード</span>
              <span className="text-lg font-extrabold tracking-[0.25em] text-accent">{profile.inviteCode}</span>
            </div>
            <button
              onClick={copyInviteLink}
              className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground"
            >
              {copied ? <IconCheck className="h-4 w-4" /> : null}
              {copied ? "コピーしました" : "招待リンクをコピー"}
            </button>
            {copyError && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-danger">
                  自動コピーに失敗しました。下のリンクを長押しして手動でコピーしてください。
                </p>
                <input
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs"
                />
              </div>
            )}
          </div>

          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">お気に入りのコーデ</h2>
              <button
                onClick={() => setFavSheet(true)}
                className="tappable text-xs font-bold text-accent"
                disabled={(posts?.length ?? 0) === 0}
              >
                選ぶ
              </button>
            </div>
            {favoritePosts.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[11px] leading-relaxed text-muted-foreground">
                お気に入りの投稿を{MAX_FAVORITE_POSTS}つまでここに固定できます。
                {(posts?.length ?? 0) === 0 && "まずは1枚投稿してみましょう。"}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {favoritePosts.map((p) => (
                  <Link key={p.id} href={`/post/${p.id}`} className="tappable">
                    <div className="relative overflow-hidden rounded-2xl bg-surface-muted" style={{ aspectRatio: "3 / 4" }}>
                      <Image src={p.imageUrl} alt={p.caption || "お気に入り"} fill className="object-cover" unoptimized />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <button
            onClick={() => setFaceSheet(true)}
            className="tappable mb-5 flex w-full items-center gap-3 rounded-3xl border border-border bg-surface p-4 text-left"
          >
            <IconCamera className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">顔パターン({faces.length}/{MAX_FACE_PATTERNS})</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                登録しておくと、コーデ投稿のたびに撮らずに選ぶだけで済みます
              </p>
            </div>
            <div className="flex -space-x-2">
              {faces.slice(0, 3).map((f) => (
                <div key={f.id} className="relative h-8 w-8 overflow-hidden rounded-full ring-2 ring-surface">
                  <Image src={f.imageUrl} alt={f.label} fill className="object-cover" unoptimized />
                </div>
              ))}
            </div>
          </button>
        </div>

        <div className="border-t border-border">
          <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold">
            <IconGrid className="h-4 w-4" /> 投稿
          </div>

          {posts === null ? (
            <div className="grid grid-cols-3 gap-[2px]">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-none" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="px-4 pb-6">
              <EmptyState
                title="まだ投稿がありません"
                description="今日決めたコーデを全身写真で残しておくと、1ヶ月分がカレンダーにたまっていきます。"
                action={
                  <Link href="/post/new">
                    <PrimaryButton full={false}>投稿してみる</PrimaryButton>
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-[2px]">
              {posts.map((p) => (
                <Link key={p.id} href={`/post/${p.id}`} className="relative aspect-square bg-surface-muted">
                  <Image src={p.imageUrl} alt={p.caption || "投稿"} fill className="object-cover" unoptimized />
                  {p.visibility === "friends" && (
                    <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">友達</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pt-8">
          <button
            onClick={signOutUser}
            className="tappable w-full rounded-full border border-border px-6 py-3 text-sm font-semibold text-muted-foreground"
          >
            サインアウト
          </button>
        </div>
      </div>

      {/* 友達シート */}
      <BottomSheet open={friendSheet} onClose={() => setFriendSheet(false)} title="友達">
        <form onSubmit={handleAddFriend} className="mb-5">
          <Field label="友達の招待コードを入力して追加">
            <div className="flex gap-2">
              <input
                value={friendCode}
                onChange={(e) => {
                  setFriendCode(e.target.value.toUpperCase());
                  if (addState.kind !== "idle") setAddState({ kind: "idle" });
                }}
                placeholder="例: AB12CD"
                maxLength={6}
                autoComplete="off"
                className={`${inputClass} flex-1 text-center tracking-widest`}
              />
              <button
                type="submit"
                disabled={!friendCode.trim() || addState.kind === "adding"}
                className="tappable shrink-0 rounded-full bg-accent px-5 text-sm font-bold text-accent-foreground disabled:opacity-40"
              >
                {addState.kind === "adding" ? "追加中…" : "追加"}
              </button>
            </div>
          </Field>
          {addState.kind === "added" && (
            <p className="-mt-2 flex items-center gap-1 text-xs text-accent">
              <IconCheck className="h-3.5 w-3.5" />
              {addState.name}さんを友達に追加しました
            </p>
          )}
          {addState.kind === "error" && <p className="-mt-2 text-xs text-danger">{addState.message}</p>}
        </form>

        {friends.length === 0 ? (
          <p className="pb-6 text-sm text-muted-foreground">
            まだ友達がいません。上のコードを教え合うと追加できます。
          </p>
        ) : (
          <ul className="space-y-2 pb-6">
            {friends.map((f) => (
              <li key={f.uid}>
                <Link
                  href={`/u/${f.uid}`}
                  className="tappable flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
                >
                  <Avatar src={f.avatarUrl} name={f.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{f.name}</p>
                    {f.handle && <p className="truncate text-[11px] text-muted-foreground">@{f.handle}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>

      {/* お気に入り選択シート */}
      <BottomSheet open={favSheet} onClose={() => setFavSheet(false)} title="お気に入りのコーデを選ぶ">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          最大{MAX_FAVORITE_POSTS}つまで選べます。上限を超えて選ぶと、いちばん古い選択が外れます。
        </p>
        <div className="grid grid-cols-3 gap-2 pb-6">
          {(posts ?? []).map((p) => {
            const selected = favoriteIds.includes(p.id);
            return (
              <button key={p.id} onClick={() => toggleFavorite(p.id)} className="tappable">
                <div
                  className={`relative overflow-hidden rounded-2xl bg-surface-muted ring-2 ${
                    selected ? "ring-accent" : "ring-transparent"
                  }`}
                  style={{ aspectRatio: "3 / 4" }}
                >
                  <Image src={p.imageUrl} alt={p.caption || "投稿"} fill className="object-cover" unoptimized />
                  {selected && (
                    <span className="animate-pop-in absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <IconCheck className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* 顔パターンシート */}
      <BottomSheet open={faceSheet} onClose={() => setFaceSheet(false)} title="顔パターン">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          髪型やメイク違いの顔写真を最大{MAX_FACE_PATTERNS}枚まで登録できます。コーデ投稿のときに選ぶだけで使えます。
        </p>
        <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleAddFace} />
        <div className="grid grid-cols-3 gap-3 pb-6">
          {faces.map((f) => (
            <div key={f.id} className="relative aspect-square overflow-hidden rounded-2xl bg-surface-muted">
              <Image src={f.imageUrl} alt={f.label} fill className="object-cover" unoptimized />
            </div>
          ))}
          {faces.length < MAX_FACE_PATTERNS && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="tappable flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border text-muted-foreground disabled:opacity-50"
            >
              <IconCamera className="h-5 w-5" />
              <span className="text-[11px]">{uploading ? "追加中…" : "追加"}</span>
            </button>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-lg font-extrabold leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] text-muted-foreground">{children}</span>
  );
}

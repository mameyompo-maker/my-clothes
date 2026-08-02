"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { addFacePattern, getFriendProfiles, listFacePatterns, MAX_FACE_PATTERNS } from "@/lib/firestore";
import { compressImage } from "@/lib/image";
import type { FacePattern, UserProfile } from "@/types/models";
import { IconCamera, IconCheck, IconUsers } from "@/components/icons";

export default function ProfilePage() {
  const { user, profile, signOutUser } = useAuth();
  const [faces, setFaces] = useState<FacePattern[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    listFacePatterns(user.uid).then(setFaces);
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    getFriendProfiles(profile.friendUids).then(setFriends);
  }, [profile]);

  const inviteUrl = profile ? `${typeof window !== "undefined" ? window.location.origin : ""}/onboarding?invite=${profile.inviteCode}` : "";

  async function copyInviteLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddFace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const label = `パターン${faces.length + 1}`;
      const compressed = await compressImage(file);
      const created = await addFacePattern(user.uid, label, compressed);
      setFaces((prev) => [...prev, created]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!user || !profile) {
    return <p className="mt-10 text-center text-sm text-muted-foreground">読み込み中…</p>;
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-10">
      <div className="mb-6 flex items-center gap-3">
        {user.photoURL && (
          <Image src={user.photoURL} alt={profile.name} width={56} height={56} className="rounded-full" unoptimized />
        )}
        <div>
          <h1 className="text-lg font-bold">{profile.name}</h1>
          <p className="text-xs text-muted-foreground">友達 {friends.length}人</p>
        </div>
      </div>

      <section className="mb-6 rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">招待コード</h2>
        <p className="mb-3 text-3xl font-bold tracking-[0.3em] text-accent">{profile.inviteCode}</p>
        <button
          onClick={copyInviteLink}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
        >
          {copied ? <IconCheck className="h-4 w-4" /> : null}
          {copied ? "コピーしました" : "招待リンクをコピー"}
        </button>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <IconUsers className="h-4 w-4" /> 友達
        </h2>
        {friends.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ友達がいません。招待コードを共有しましょう。</p>
        ) : (
          <ul className="space-y-2">
            {friends.map((f) => (
              <li key={f.uid} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                {f.avatarUrl && <Image src={f.avatarUrl} alt={f.name} width={32} height={32} className="rounded-full" unoptimized />}
                <span className="text-sm">{f.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold">顔パターン</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          髪型やメイク違いの顔写真を最大{MAX_FACE_PATTERNS}枚登録しておくと、投稿のたびに撮影しなくても選ぶだけでコーデ合成に使えます。
        </p>
        <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleAddFace} />
        <div className="grid grid-cols-3 gap-3">
          {faces.map((f) => (
            <div key={f.id} className="relative aspect-square overflow-hidden rounded-2xl bg-surface-muted">
              <Image src={f.imageUrl} alt={f.label} fill className="object-cover" unoptimized />
            </div>
          ))}
          {faces.length < MAX_FACE_PATTERNS && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border text-muted-foreground disabled:opacity-50"
            >
              <IconCamera className="h-5 w-5" />
              <span className="text-[11px]">{uploading ? "追加中…" : "追加"}</span>
            </button>
          )}
        </div>
      </section>

      <button
        onClick={signOutUser}
        className="w-full rounded-full border border-border px-6 py-3 text-sm font-semibold text-muted-foreground"
      >
        サインアウト
      </button>
    </div>
  );
}

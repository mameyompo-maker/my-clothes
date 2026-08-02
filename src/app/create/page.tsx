"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createOutfitPost,
  getFriendProfiles,
  listClosetItems,
  listFacePatterns,
  uploadImage,
} from "@/lib/firestore";
import { composeOutfitImage } from "@/lib/functions";
import { compressImage } from "@/lib/image";
import { CLOSET_CATEGORIES, type ClosetCategory, type ClosetItem, type FacePattern, type OutfitCandidate, type UserProfile } from "@/types/models";
import { IconCamera } from "@/components/icons";

interface CandidateDraft {
  itemIdsByCategory: Partial<Record<ClosetCategory, string>>;
  facePatternId: string | null;
  liveCaptureFile: File | null;
  liveCapturePreviewUrl: string | null;
}

function emptyDraft(): CandidateDraft {
  return { itemIdsByCategory: {}, facePatternId: null, liveCaptureFile: null, liveCapturePreviewUrl: null };
}

export default function CreatePostPage() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  const [faces, setFaces] = useState<FacePattern[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);

  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [drafts, setDrafts] = useState<[CandidateDraft, CandidateDraft]>([emptyDraft(), emptyDraft()]);
  const [activeCategory, setActiveCategory] = useState<ClosetCategory>("tops");

  const [mood, setMood] = useState("");
  const [note, setNote] = useState("");
  const [sharedWith, setSharedWith] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || !profile) return;
    listClosetItems(user.uid).then(setClosetItems);
    listFacePatterns(user.uid).then(setFaces);
    getFriendProfiles(profile.friendUids).then((f) => {
      setFriends(f);
      setSharedWith(new Set(f.map((x) => x.uid)));
    });
  }, [user, profile]);

  function updateDraft(slot: 0 | 1, patch: Partial<CandidateDraft>) {
    setDrafts((prev) => {
      const next: [CandidateDraft, CandidateDraft] = [...prev];
      next[slot] = { ...next[slot], ...patch };
      return next;
    });
  }

  function toggleItem(slot: 0 | 1, category: ClosetCategory, itemId: string) {
    const current = drafts[slot].itemIdsByCategory[category];
    const nextMap = { ...drafts[slot].itemIdsByCategory };
    if (current === itemId) {
      delete nextMap[category];
    } else {
      nextMap[category] = itemId;
    }
    updateDraft(slot, { itemIdsByCategory: nextMap });
  }

  function selectFace(slot: 0 | 1, facePatternId: string) {
    updateDraft(slot, { facePatternId, liveCaptureFile: null, liveCapturePreviewUrl: null });
  }

  function handleLiveCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    updateDraft(activeSlot, {
      liveCaptureFile: file,
      liveCapturePreviewUrl: URL.createObjectURL(file),
      facePatternId: null,
    });
  }

  function toggleFriend(uid: string) {
    setSharedWith((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  const draftReady = (d: CandidateDraft) =>
    Object.keys(d.itemIdsByCategory).length > 0 && (d.facePatternId || d.liveCaptureFile);
  const canSubmit = user && draftReady(drafts[0]) && draftReady(drafts[1]) && mood.trim() && !submitting;

  async function handleSubmit() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const candidates: OutfitCandidate[] = [];
      for (const d of drafts) {
        let liveCaptureUrl: string | null = null;
        if (d.liveCaptureFile) {
          const compressed = await compressImage(d.liveCaptureFile);
          liveCaptureUrl = await uploadImage(`outfits/${user.uid}/${crypto.randomUUID()}.jpg`, compressed);
        }
        candidates.push({
          itemIds: Object.values(d.itemIdsByCategory) as string[],
          facePatternId: liveCaptureUrl ? null : d.facePatternId,
          liveCaptureUrl,
          composedImageUrl: null,
          composeStatus: "pending",
        });
      }

      const post = await createOutfitPost(user.uid, mood.trim(), note.trim(), candidates, Array.from(sharedWith));

      // AI合成は失敗しても投稿自体は成立させる(合成なしでも投票はできる)。
      await Promise.allSettled(
        candidates.map((_, index) => composeOutfitImage({ postId: post.id, candidateIndex: index }))
      );

      router.push("/feed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  const draft = drafts[activeSlot];
  const itemsInCategory = closetItems.filter((i) => i.category === activeCategory);
  const selectedItemsForSlot = (slot: 0 | 1) =>
    Object.values(drafts[slot].itemIdsByCategory)
      .map((id) => closetItems.find((i) => i.id === id))
      .filter((i): i is ClosetItem => Boolean(i));

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-10">
      <h1 className="mb-4 text-xl font-bold">今日のコーデを投稿</h1>

      <div className="mb-4 flex gap-2">
        {[0, 1].map((slot) => (
          <button
            key={slot}
            onClick={() => setActiveSlot(slot as 0 | 1)}
            className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold ${
              activeSlot === slot ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground"
            }`}
          >
            候補{slot === 0 ? "A" : "B"} {draftReady(drafts[slot]) ? "✓" : ""}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {selectedItemsForSlot(activeSlot).map((item) => (
          <span key={item.id} className="rounded-full bg-surface-muted px-3 py-1 text-xs">
            {item.label}
          </span>
        ))}
        {selectedItemsForSlot(activeSlot).length === 0 && (
          <span className="text-xs text-muted-foreground">下から服を選んでください</span>
        )}
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {CLOSET_CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setActiveCategory(c.value)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm ${
              activeCategory === c.value ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-4 gap-2">
        {itemsInCategory.map((item) => {
          const selected = draft.itemIdsByCategory[activeCategory] === item.id;
          return (
            <button
              key={item.id}
              onClick={() => toggleItem(activeSlot, activeCategory, item.id)}
              className={`relative aspect-square overflow-hidden rounded-xl ring-2 ${
                selected ? "ring-accent" : "ring-transparent"
              }`}
            >
              <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
            </button>
          );
        })}
        {itemsInCategory.length === 0 && (
          <p className="col-span-4 text-xs text-muted-foreground">このカテゴリーにアイテムがありません。</p>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold">今日の顔</h2>
      <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleLiveCapture} />
      <div className="mb-6 grid grid-cols-4 gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-dashed text-muted-foreground ${
            draft.liveCaptureFile ? "border-accent text-accent" : "border-border"
          }`}
        >
          {draft.liveCapturePreviewUrl ? (
            <Image src={draft.liveCapturePreviewUrl} alt="今その場で撮影" fill className="rounded-xl object-cover" unoptimized />
          ) : (
            <>
              <IconCamera className="h-5 w-5" />
              <span className="text-[10px]">その場で撮影</span>
            </>
          )}
        </button>
        {faces.map((f) => (
          <button
            key={f.id}
            onClick={() => selectFace(activeSlot, f.id)}
            className={`relative aspect-square overflow-hidden rounded-xl ring-2 ${
              draft.facePatternId === f.id ? "ring-accent" : "ring-transparent"
            }`}
          >
            <Image src={f.imageUrl} alt={f.label} fill className="object-cover" unoptimized />
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium text-muted-foreground">今日の気分・予定</label>
      <input
        value={mood}
        onChange={(e) => setMood(e.target.value)}
        placeholder="例: 今日はデート、ちょっと気合い入れたい"
        className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
      />

      <label className="mb-1 block text-xs font-medium text-muted-foreground">補足(任意)</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mb-5 w-full resize-none rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
      />

      <h2 className="mb-2 text-sm font-semibold">共有する友達</h2>
      <div className="mb-6 space-y-2">
        {friends.length === 0 && <p className="text-xs text-muted-foreground">友達がいません。プロフィールから招待しましょう。</p>}
        {friends.map((f) => (
          <label key={f.uid} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
            <input type="checkbox" checked={sharedWith.has(f.uid)} onChange={() => toggleFriend(f.uid)} className="h-4 w-4 accent-[var(--color-accent)]" />
            {f.avatarUrl && <Image src={f.avatarUrl} alt={f.name} width={28} height={28} className="rounded-full" unoptimized />}
            <span className="text-sm">{f.name}</span>
          </label>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30 disabled:opacity-50"
      >
        {submitting ? "投稿中…" : "投稿して友達に投票してもらう"}
      </button>
    </div>
  );
}

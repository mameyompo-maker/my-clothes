"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createStylePost, getOutfitPost, listClosetItems } from "@/lib/firestore";
import { compressImage } from "@/lib/image";
import {
  SEASONS,
  STYLE_GENRES,
  seasonOfMonth,
  type ClosetItem,
  type ItemTag,
  type PostVisibility,
  type Season,
  type StyleGenre,
} from "@/types/models";
import { ActionBar, BottomSheet, Chip, Field, IconButton, PrimaryButton, TopBar, inputClass } from "@/components/ui";
import { IconCamera, IconChevronLeft, IconTag, IconX } from "@/components/icons";

export default function NewStylePostPage() {
  return (
    <Suspense fallback={null}>
      <NewStylePostContent />
    </Suspense>
  );
}

function NewStylePostContent() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const outfitPostId = searchParams.get("outfit");
  const candidateIndex = searchParams.get("candidate");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [genres, setGenres] = useState<StyleGenre[]>([]);
  const [season, setSeason] = useState<Season | null>(seasonOfMonth(new Date().getMonth() + 1));
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [itemTags, setItemTags] = useState<ItemTag[]>([]);
  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid).then(setClosetItems);
  }, [user]);

  // 2択で「これを着る」と決めた直後に来た場合、その候補の服をタグの初期値にしておく。
  useEffect(() => {
    if (!outfitPostId || candidateIndex === null || closetItems.length === 0) return;
    let cancelled = false;
    getOutfitPost(outfitPostId).then((post) => {
      if (cancelled || !post) return;
      const candidate = post.candidates[Number(candidateIndex)];
      if (!candidate) return;
      const tags = candidate.itemIds
        .map((id) => closetItems.find((i) => i.id === id))
        .filter((i): i is ClosetItem => Boolean(i))
        .map((item, idx, arr) => ({
          itemId: item.id,
          label: item.label,
          brand: item.brand ?? "",
          category: item.category,
          // まだ写真上の位置を指定していないので、右端に縦に並べておく。あとから動かせる。
          x: 0.82,
          y: 0.2 + (idx * 0.6) / Math.max(arr.length, 1),
        }));
      setItemTags(tags);
    });
    return () => {
      cancelled = true;
    };
  }, [outfitPostId, candidateIndex, closetItems]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function handleImageTap(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPendingPoint({ x, y });
  }

  function addTag(item: ClosetItem) {
    if (!pendingPoint) return;
    setItemTags((prev) => [
      ...prev,
      {
        itemId: item.id,
        label: item.label,
        brand: item.brand ?? "",
        category: item.category,
        x: pendingPoint.x,
        y: pendingPoint.y,
      },
    ]);
    setPendingPoint(null);
  }

  function toggleGenre(value: StyleGenre) {
    setGenres((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSubmit() {
    if (!user || !profile || !file) return;
    setSaving(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      const post = await createStylePost(
        profile,
        {
          caption: caption.trim(),
          itemTags,
          genres,
          season,
          visibility,
          outfitPostId,
        },
        compressed
      );
      router.push(`/post/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿に失敗しました。");
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar
        title="コーデを投稿"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        {previewUrl ? (
          <div className="mb-2">
            <div
              ref={imageRef}
              onClick={handleImageTap}
              className="relative w-full overflow-hidden rounded-none bg-surface-muted"
              style={{ aspectRatio: "3 / 4" }}
            >
              <Image src={previewUrl} alt="投稿する写真" fill className="object-cover" unoptimized />

              {itemTags.map((tag, i) => (
                <span
                  key={i}
                  className="animate-pop-in absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur"
                  style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
                >
                  {tag.brand ? `${tag.brand} / ` : ""}
                  {tag.label}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setItemTags((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    aria-label="タグを削除"
                    className="ml-0.5"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                </span>
              ))}

              {pendingPoint && (
                <span
                  className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent"
                  style={{ left: `${pendingPoint.x * 100}%`, top: `${pendingPoint.y * 100}%` }}
                />
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <IconTag className="h-3.5 w-3.5" />
              写真をタップすると、その位置に着ているアイテムのタグを付けられます
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="tappable mt-1 text-xs font-semibold text-foreground"
            >
              写真を選び直す
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="tappable mb-5 flex w-full flex-col items-center justify-center gap-2 rounded-none border-2 border-dashed border-border bg-surface-muted py-20 text-muted-foreground"
          >
            <IconCamera className="h-10 w-10" />
            <span className="text-sm font-semibold">全身写真を撮る / 選ぶ</span>
            <span className="px-10 text-center text-[11px] leading-relaxed">
              今日決めたコーデを記録しましょう。友達がいなくても公開できます
            </span>
          </button>
        )}

        <div className="mt-5">
          <Field label="キャプション">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              placeholder="今日は友達とカフェ。差し色に赤のバッグ"
              className={`${inputClass} resize-none`}
            />
          </Field>

          <Field label="公開範囲">
            <div className="flex gap-2">
              <Chip selected={visibility === "public"} onClick={() => setVisibility("public")}>
                みんなに公開
              </Chip>
              <Chip selected={visibility === "friends"} onClick={() => setVisibility("friends")}>
                友達だけ
              </Chip>
            </div>
          </Field>

          <Field label="ジャンル">
            <div className="flex flex-wrap gap-2">
              {STYLE_GENRES.map((g) => (
                <Chip key={g.value} size="sm" selected={genres.includes(g.value)} onClick={() => toggleGenre(g.value)}>
                  {g.label}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="季節">
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => (
                <Chip
                  key={s.value}
                  size="sm"
                  selected={season === s.value}
                  onClick={() => setSeason(season === s.value ? null : s.value)}
                >
                  {s.emoji} {s.label}
                </Chip>
              ))}
            </div>
          </Field>
        </div>

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      </div>

      <ActionBar>
        <PrimaryButton onClick={handleSubmit} disabled={!file || saving}>
          {saving ? "投稿中…" : "投稿する"}
        </PrimaryButton>
      </ActionBar>

      <BottomSheet
        open={Boolean(pendingPoint)}
        onClose={() => setPendingPoint(null)}
        title="この位置に付けるアイテム"
      >
        {closetItems.length === 0 ? (
          <p className="pb-6 text-sm text-muted-foreground">
            クローゼットに服がありません。先に登録するとタグ付けできます。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 pb-6">
            {closetItems.map((item) => (
              <button key={item.id} onClick={() => addTag(item)} className="tappable text-left">
                <div className="relative mb-1 w-full overflow-hidden rounded-none bg-surface-muted" style={{ aspectRatio: "3 / 4" }}>
                  <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                </div>
                <span className="block truncate text-[11px]">{item.label}</span>
                {item.brand && <span className="block truncate text-[10px] text-muted-foreground">{item.brand}</span>}
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

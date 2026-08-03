"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addClosetItem } from "@/lib/firestore";
import { compressImage } from "@/lib/image";
import {
  CLOSET_CATEGORIES,
  SEASONS,
  STYLE_GENRES,
  type ClosetCategory,
  type Season,
  type StyleGenre,
} from "@/types/models";
import { ActionBar, Chip, Field, IconButton, PrimaryButton, TopBar, inputClass } from "@/components/ui";
import { IconCamera, IconChevronLeft } from "@/components/icons";

export default function AddClosetItemPage() {
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<ClosetCategory>("tops");
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [genres, setGenres] = useState<StyleGenre[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function toggleGenre(value: StyleGenre) {
    setGenres((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function toggleSeason(value: Season) {
    setSeasons((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSubmit() {
    if (!user || !file || !label.trim()) return;
    setSaving(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      await addClosetItem(
        user.uid,
        {
          category,
          label: label.trim(),
          brand: brand.trim(),
          size: size.trim(),
          color: color.trim(),
          genres,
          seasons,
          memo: memo.trim(),
        },
        compressed
      );
      router.push("/closet");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar
        title="服を登録"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          className="tappable relative mb-5 flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-none border-2 border-dashed border-border bg-surface-muted text-muted-foreground"
        >
          {previewUrl ? (
            <Image src={previewUrl} alt="プレビュー" fill className="object-cover" unoptimized />
          ) : (
            <>
              <IconCamera className="h-9 w-9" />
              <span className="text-sm font-semibold">写真を撮る / 選ぶ</span>
              <span className="px-8 text-center text-[11px] leading-relaxed">
                床や壁に置いて真上から撮ると、あとで見返しやすくなります
              </span>
            </>
          )}
        </button>

        <Field label="カテゴリー">
          <div className="flex flex-wrap gap-2">
            {CLOSET_CATEGORIES.map((c) => (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="アイテム名">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: グレーのざっくりニット"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="ブランド">
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="GU" className={inputClass} />
          </Field>
          <Field label="サイズ">
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" className={inputClass} />
          </Field>
          <Field label="色">
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="グレー" className={inputClass} />
          </Field>
        </div>

        <Field label="ジャンル" hint="複数選べます。あとで絞り込みやおすすめに使われます。">
          <div className="flex flex-wrap gap-2">
            {STYLE_GENRES.map((g) => (
              <Chip key={g.value} size="sm" selected={genres.includes(g.value)} onClick={() => toggleGenre(g.value)}>
                {g.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="季節" hint="選ばなければ通年として扱います。">
          <div className="flex flex-wrap gap-2">
            {SEASONS.map((s) => (
              <Chip key={s.value} size="sm" selected={seasons.includes(s.value)} onClick={() => toggleSeason(s.value)}>
                {s.emoji} {s.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="メモ(任意)">
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="例: 洗濯機NG、丈が長めなのでスニーカーと合う"
            className={`${inputClass} resize-none`}
          />
        </Field>

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      </div>

      <ActionBar>
        <PrimaryButton onClick={handleSubmit} disabled={!file || !label.trim() || saving}>
          {saving ? "保存中…" : "クローゼットに追加"}
        </PrimaryButton>
      </ActionBar>
    </>
  );
}

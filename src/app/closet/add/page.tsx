"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addClosetItem } from "@/lib/firestore";
import { CLOSET_CATEGORIES, type ClosetCategory } from "@/types/models";
import { IconCamera, IconChevronLeft } from "@/components/icons";

export default function AddClosetItemPage() {
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<ClosetCategory>("tops");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function handleSubmit() {
    if (!user || !file || !label.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addClosetItem(user.uid, category, label.trim(), file);
      router.push("/closet");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => router.back()} className="rounded-full p-1.5 hover:bg-surface-muted">
          <IconChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">アイテムを追加</h1>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="mb-5 flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl border-2 border-dashed border-border bg-surface-muted text-muted-foreground"
      >
        {previewUrl ? (
          <Image src={previewUrl} alt="プレビュー" width={300} height={300} className="h-full w-full object-cover" unoptimized />
        ) : (
          <>
            <IconCamera className="h-8 w-8" />
            <span className="text-sm">写真を撮る / 選ぶ</span>
          </>
        )}
      </button>

      <label className="mb-1 block text-xs font-medium text-muted-foreground">カテゴリー</label>
      <div className="mb-5 flex flex-wrap gap-2">
        {CLOSET_CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              category === c.value ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium text-muted-foreground">アイテム名</label>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="例: グレーのニット"
        className="mb-5 w-full rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
      />

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!file || !label.trim() || saving}
        className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30 disabled:opacity-50"
      >
        {saving ? "保存中…" : "クローゼットに追加"}
      </button>
    </div>
  );
}

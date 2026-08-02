"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listClosetItems } from "@/lib/firestore";
import { CLOSET_CATEGORIES, type ClosetCategory, type ClosetItem } from "@/types/models";
import { IconPlus } from "@/components/icons";

export default function ClosetPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ClosetItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<ClosetCategory | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [user]);

  const filtered = useMemo(
    () => (activeCategory === "all" ? items : items.filter((i) => i.category === activeCategory)),
    [items, activeCategory]
  );

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">クローゼット</h1>
        <Link
          href="/closet/add"
          className="flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
        >
          <IconPlus className="h-4 w-4" />
          追加
        </Link>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <CategoryChip label="すべて" active={activeCategory === "all"} onClick={() => setActiveCategory("all")} />
        {CLOSET_CATEGORIES.map((c) => (
          <CategoryChip
            key={c.value}
            label={c.label}
            active={activeCategory === c.value}
            onClick={() => setActiveCategory(c.value)}
          />
        ))}
      </div>

      {loading ? (
        <p className="text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          まだアイテムがありません。「追加」から服を登録しましょう。
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div key={item.id} className="flex flex-col items-center gap-1.5">
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-surface-muted">
                <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
              </div>
              <span className="w-full truncate text-center text-xs text-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors ${
        active ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  deleteClosetItem,
  listClosetItems,
  replaceSeedClosetItems,
  updateClosetItem,
} from "@/lib/firestore";
import { seedItemsFor, WARDROBE_STYLES, type WardrobeStyle } from "@/data/seedClosetItems";
import {
  CLOSET_CATEGORIES,
  SEASONS,
  STYLE_GENRES,
  seasonOfMonth,
  type ClosetCategory,
  type ClosetItem,
  type Season,
  type StyleGenre,
} from "@/types/models";
import { HangerRail } from "@/components/HangerRail";
import {
  Avatar,
  BottomSheet,
  Chip,
  EmptyState,
  Field,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  TopBar,
  inputClass,
} from "@/components/ui";
import { IconCloset, IconPlus, IconTrash } from "@/components/icons";

export default function ClosetPage() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [category, setCategory] = useState<ClosetCategory | "all">("all");
  const [genre, setGenre] = useState<StyleGenre | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [editing, setEditing] = useState<ClosetItem | null>(null);

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid).then(setItems);
  }, [user]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (genre && !(i.genres ?? []).includes(genre)) return false;
      // 季節タグが空のアイテムは通年扱いで常に残す。登録直後に消えると混乱するため。
      if (season && (i.seasons ?? []).length > 0 && !(i.seasons ?? []).includes(season)) return false;
      return true;
    });
  }, [items, category, genre, season]);

  const thisSeason = seasonOfMonth(new Date().getMonth() + 1);

  // 初期投入分がイラスト(SVG)を指したまま残っているアカウントの検出。
  // イラストは配信を止めたので、この状態だと画像が全部壊れて表示される。
  const hasBrokenSeed = (items ?? []).some((i) => i.isSeed && i.imageUrl.endsWith(".svg"));

  async function reloadItems() {
    if (!user) return;
    setItems(await listClosetItems(user.uid));
  }

  async function handleSaveEdit(patch: Partial<ClosetItem>) {
    if (!editing) return;
    await updateClosetItem(editing.id, patch);
    setItems((prev) => (prev ?? []).map((i) => (i.id === editing.id ? { ...i, ...patch } : i)));
    setEditing(null);
  }

  async function handleDelete() {
    if (!editing) return;
    await deleteClosetItem(editing.id);
    setItems((prev) => (prev ?? []).filter((i) => i.id !== editing.id));
    setEditing(null);
  }

  return (
    <>
      <TopBar
        left={
          <div className="flex items-center gap-2">
            {profile && <Avatar src={profile.avatarUrl} name={profile.name} size={30} />}
            <span className="text-base font-bold tracking-tight">クローゼット</span>
          </div>
        }
        right={
          <Link href="/closet/add" aria-label="服を追加">
            <IconButton label="服を追加">
              <IconPlus className="h-5 w-5" />
            </IconButton>
          </Link>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
        {hasBrokenSeed && user && (
          <div className="mb-5 rounded-3xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm font-bold text-accent">初期クローゼットの写真を入れ替えられます</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              最初から入っていたイラストを、実際の服の写真に差し替えました。
              下から選んで入れ直してください。自分で登録した服はそのまま残ります。
            </p>
            <SeedClosetPicker uid={user.uid} onDone={reloadItems} />
          </div>
        )}

        <div className="no-scrollbar -mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4">
          <Chip selected={category === "all"} onClick={() => setCategory("all")}>
            すべて{items ? ` (${items.length})` : ""}
          </Chip>
          {CLOSET_CATEGORIES.map((c) => {
            const count = (items ?? []).filter((i) => i.category === c.value).length;
            if (count === 0 && category !== c.value) return null;
            return (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label} ({count})
              </Chip>
            );
          })}
        </div>

        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          {SEASONS.map((s) => (
            <Chip
              key={s.value}
              size="sm"
              selected={season === s.value}
              onClick={() => setSeason(season === s.value ? null : s.value)}
            >
              {s.emoji} {s.label}
              {s.value === thisSeason ? "・今" : ""}
            </Chip>
          ))}
        </div>

        <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
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

        {items === null ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <>
            <EmptyState
              icon={<IconCloset className="h-10 w-10" />}
              title={items.length === 0 ? "クローゼットが空です" : "条件に合う服がありません"}
              description={
                items.length === 0
                  ? "買った服を先に登録しておくと、毎朝の組み合わせ選びが一気に速くなります。"
                  : "絞り込みを変えてみてください。"
              }
              action={
                items.length === 0 ? (
                  <Link href="/closet/add">
                    <PrimaryButton full={false}>最初の1着を登録</PrimaryButton>
                  </Link>
                ) : undefined
              }
            />
            {items.length === 0 && user && (
              <div className="mt-4 rounded-3xl border border-border bg-surface p-4">
                <p className="text-sm font-bold">見本の服から始めることもできます</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  実際の服の写真を入れておけるので、自分の服を撮る前でも2択を試せます。
                </p>
                <SeedClosetPicker uid={user.uid} onDone={reloadItems} />
              </div>
            )}
          </>
        ) : (
          <HangerRail items={filtered} onSelect={(item) => setEditing(item)} />
        )}
      </div>

      <BottomSheet open={Boolean(editing)} onClose={() => setEditing(null)} title="アイテムの情報">
        {editing && <EditItemForm item={editing} onSave={handleSaveEdit} onDelete={handleDelete} />}
      </BottomSheet>
    </>
  );
}

/**
 * 初期クローゼットを選んで入れ直す。
 *
 * オンボーディングの選択はサインイン時にしか通らず、しかも「クローゼットが空のとき」
 * だけしか投入しない。既にアカウントを持っている人には届かないので、ここから
 * いつでも選び直せるようにしている。
 */
function SeedClosetPicker({ uid, onDone }: { uid: string; onDone: () => Promise<void> }) {
  const [style, setStyle] = useState<WardrobeStyle>("women");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setWorking(true);
    setError(null);
    try {
      await replaceSeedClosetItems(uid, seedItemsFor(style));
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "入れ替えに失敗しました。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="space-y-2">
        {WARDROBE_STYLES.map((option) => {
          const selected = style === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setStyle(option.value)}
              aria-pressed={selected}
              className={`tappable w-full rounded-2xl border px-4 py-2.5 text-left transition-colors ${
                selected ? "border-accent bg-surface" : "border-border bg-surface"
              }`}
            >
              <span className={`block text-sm font-semibold ${selected ? "text-accent" : ""}`}>
                {option.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {option.caption}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <PrimaryButton onClick={handleApply} disabled={working}>
          {working ? "入れ替えています…" : "この内容で入れ直す"}
        </PrimaryButton>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function EditItemForm({
  item,
  onSave,
  onDelete,
}: {
  item: ClosetItem;
  onSave: (patch: Partial<ClosetItem>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [label, setLabel] = useState(item.label);
  const [brand, setBrand] = useState(item.brand ?? "");
  const [size, setSize] = useState(item.size ?? "");
  const [color, setColor] = useState(item.color ?? "");
  const [genres, setGenres] = useState<StyleGenre[]>(item.genres ?? []);
  const [seasons, setSeasons] = useState<Season[]>(item.seasons ?? []);
  const [category, setCategory] = useState<ClosetCategory>(item.category);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function toggleGenre(value: StyleGenre) {
    setGenres((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function toggleSeason(value: Season) {
    setSeasons((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div>
      <div className="mb-4 flex gap-3">
        <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-surface-muted">
          <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
        </div>
        <div className="min-w-0 flex-1">
          <Field label="名前">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>

      <Field label="カテゴリー">
        <div className="flex flex-wrap gap-2">
          {CLOSET_CATEGORIES.map((c) => (
            <Chip key={c.value} size="sm" selected={category === c.value} onClick={() => setCategory(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field label="ブランド">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} placeholder="GU" />
        </Field>
        <Field label="サイズ">
          <input value={size} onChange={(e) => setSize(e.target.value)} className={inputClass} placeholder="M" />
        </Field>
        <Field label="色">
          <input value={color} onChange={(e) => setColor(e.target.value)} className={inputClass} placeholder="白" />
        </Field>
      </div>

      <Field label="ジャンル">
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

      {(item.wearCount ?? 0) > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">これまで{item.wearCount}回着ています。</p>
      )}

      <div className="mb-3">
        <PrimaryButton
          disabled={saving || !label.trim()}
          onClick={async () => {
            setSaving(true);
            await onSave({ label: label.trim(), brand, size, color, genres, seasons, category });
            setSaving(false);
          }}
        >
          {saving ? "保存中…" : "保存する"}
        </PrimaryButton>
      </div>

      {confirmDelete ? (
        <div className="mb-4 rounded-2xl border border-danger/40 bg-danger/5 p-3">
          <p className="mb-2 text-xs">この服をクローゼットから削除します。元に戻せません。</p>
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="tappable flex-1 rounded-full bg-danger px-4 py-2.5 text-sm font-bold text-white"
            >
              削除する
            </button>
            <SecondaryButton full={false} onClick={() => setConfirmDelete(false)}>
              やめる
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="tappable mb-4 flex w-full items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground"
        >
          <IconTrash className="h-4 w-4" /> このアイテムを削除
        </button>
      )}
    </div>
  );
}

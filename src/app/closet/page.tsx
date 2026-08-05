"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  addSeedClosetItems,
  deleteClosetItem,
  deleteSavedOutfit,
  listClosetItems,
  listSavedOutfits,
  replaceSeedClosetItems,
  updateClosetItem,
  updateSavedOutfit,
  updateUserProfile,
} from "@/lib/firestore";
import { seedItemsFor, WARDROBE_STYLES, type WardrobeStyle } from "@/data/seedClosetItems";
import {
  CLOSET_CATEGORIES,
  parseHashtags,
  parsePrice,
  SEASONS,
  STYLE_GENRES,
  seasonOfMonth,
  BODY_TYPES,
  WARDROBE_LABELS,
  otherWardrobe,
  wardrobeOfItem,
  type BodyType,
  type ClosetCategory,
  type ClosetItem,
  type SavedOutfit,
  type Season,
  type StyleGenre,
  type Wardrobe,
} from "@/types/models";
import { ClosetCardGrid, WardrobeCarousel } from "@/components/WardrobeCloset";
import { downloadJson } from "@/lib/share";
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
  timeAgo,
} from "@/components/ui";
import { IconCloset, IconPlus, IconTrash } from "@/components/icons";

/** 並び替えの軸。「眠っている順」はタンスの肥やしを掘り起こすためのもの。 */
type SortKey = "recent" | "worn" | "dormant";

const SORT_LABELS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "追加した順" },
  { value: "worn", label: "よく着る順" },
  { value: "dormant", label: "眠っている順" },
];

/** これより長く着ていない服を「眠っている」とみなす。掘り起こしの入口にする。 */
const DORMANT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * クローゼットで表示する一式(メンズ / ウィメンズ / すべて)。
 *
 * 既定はプロフィールの「主に使う服」(`primaryWardrobe`)だが、**この画面で選び直したら
 * その選択が優先され、端末に残る**(Kazさん指示 2026-08-05)。リロードしても他の画面へ
 * 行って戻っても引き継がれる。サーバーに持たせていないのは、プロフィールの
 * 「主に使う服」は2択作成などの既定値も兼ねる別物で、ここでの一時的な見せ方の切り替えと
 * 混ぜたくないため。
 */
type WardrobeChoice = Wardrobe | "all";

const CLOSET_WARDROBE_KEY = "mc.closetWardrobe.";

function isWardrobeChoice(v: string | null): v is WardrobeChoice {
  return v === "men" || v === "women" || v === "all";
}

export default function ClosetPage() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [category, setCategory] = useState<ClosetCategory | "all">("all");
  const [genre, setGenre] = useState<StyleGenre | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [editing, setEditing] = useState<ClosetItem | null>(null);
  const [seedSheetOpen, setSeedSheetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  // ワードローブの中央に掛けるアイテム。未選択なら一覧の先頭。
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  // 「アイテム / コーデ」の表示切り替え。コーデ=保存した服の組み合わせ。
  const [view, setView] = useState<"items" | "outfits">("items");
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[] | null>(null);
  // null = まだ端末の設定を読んでいない(= プロフィールの既定に従う)。
  const [wardrobeChoice, setWardrobeChoice] = useState<WardrobeChoice | null>(null);
  const [editingOutfit, setEditingOutfit] = useState<SavedOutfit | null>(null);
  const [outfitName, setOutfitName] = useState("");
  const [ioNote, setIoNote] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  // 「眠っている服」の基準時刻は読み込み時に一度だけ決める。描画のたびに Date.now() を
  // 読むと、再描画のたびに結果が変わりうる不安定な値になってしまうため。
  // 件数そのものは、表示中の一式に合わせて数え直す(下の useMemo)。
  const [dormantBefore, setDormantBefore] = useState(0);

  useEffect(() => {
    if (!user) return;
    listClosetItems(user.uid).then((list) => {
      setItems(list);
      setDormantBefore(Date.now() - DORMANT_MS);
    });
    listSavedOutfits(user.uid).then(setSavedOutfits);
  }, [user]);

  // 前回この画面で選んだ一式を復元する。effect の本体で同期に setState すると
  // レンダリングが連鎖するので、マイクロタスクに逃がしてから反映する。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    queueMicrotask(() => {
      const stored = localStorage.getItem(CLOSET_WARDROBE_KEY + user.uid);
      if (!cancelled && isWardrobeChoice(stored)) setWardrobeChoice(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 選び直していなければプロフィールの「主に使う服」に従う。それも未設定なら全部出す。
  const wardrobe: WardrobeChoice = wardrobeChoice ?? profile?.primaryWardrobe ?? "all";

  function chooseWardrobe(next: WardrobeChoice) {
    setWardrobeChoice(next);
    if (user) localStorage.setItem(CLOSET_WARDROBE_KEY + user.uid, next);
  }

  /**
   * 選んだ一式の服だけに絞ったもの。件数表示も絞り込みもすべてこれを基準にする
   * (`items` のままだと「メンズ (4)」と書いてあるのに中身が違う、という食い違いが出る)。
   *
   * **メンズ/ウィメンズを指定していない服は、どちらを選んでいても残す。**
   * 指定は任意項目なので、付け忘れた自分の服が消えるほうが困る。
   */
  const wardrobeItems = useMemo(() => {
    if (!items) return null;
    if (wardrobe === "all") return items;
    return items.filter((i) => {
      const w = wardrobeOfItem(i);
      return w === null || w === wardrobe;
    });
  }, [items, wardrobe]);

  /**
   * 切り替えの並び。プロフィールで選んだほうを左に置く(そちらが既定なので)。
   * 未設定ならウィメンズ→メンズの順。「すべて表示」は末尾に別途置く。
   */
  const wardrobeOrder: Wardrobe[] = profile?.primaryWardrobe
    ? [profile.primaryWardrobe, otherWardrobe(profile.primaryWardrobe)]
    : ["women", "men"];

  /** 見出しなどに出す表示名。"all" のときに WARDROBE_LABELS を引けないので分けてある。 */
  const wardrobeLabel = wardrobe === "all" ? "すべて" : WARDROBE_LABELS[wardrobe];

  /** その一式を選んだときに出る件数。絞り込みと同じ数え方(指定なしも含む)にする。 */
  function wardrobeCount(w: Wardrobe): number | null {
    if (!items) return null;
    return items.filter((i) => {
      const kind = wardrobeOfItem(i);
      return kind === null || kind === w;
    }).length;
  }

  /** 「指定なし」の服があるか。あるときだけ、消えない理由を一言添える。 */
  const hasUnspecified = useMemo(
    () => (items ?? []).some((i) => wardrobeOfItem(i) === null),
    [items]
  );

  /** 眠っている服の数。表示中の一式のぶんだけ数える。 */
  const dormantCount = useMemo(() => {
    if (!dormantBefore) return 0;
    return (wardrobeItems ?? []).filter((i) => (i.lastWornAt ?? 0) < dormantBefore).length;
  }, [wardrobeItems, dormantBefore]);

  const filtered = useMemo(() => {
    if (!wardrobeItems) return [];
    const q = search.trim().toLowerCase();
    const list = wardrobeItems.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (genre && !(i.genres ?? []).includes(genre)) return false;
      // 季節タグが空のアイテムは通年扱いで常に残す。登録直後に消えると混乱するため。
      if (season && (i.seasons ?? []).length > 0 && !(i.seasons ?? []).includes(season)) return false;
      if (q) {
        // 服は名前だけで探せないことが多い(「あの黒いやつ」)。ブランド・色・メモも見る。
        const haystack = [i.label, i.brand, i.color, i.memo].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    if (sort === "worn") {
      sorted.sort((a, b) => (b.wearCount ?? 0) - (a.wearCount ?? 0));
    } else if (sort === "dormant") {
      // 眠っている順。一度も着ていない服を先頭に出す(掘り起こしが目的なので)。
      sorted.sort((a, b) => (a.lastWornAt ?? 0) - (b.lastWornAt ?? 0));
    } else {
      sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
    // お気に入りは並び順を保ったまま先頭に浮かせる(sort は安定ソートなので順序は崩れない)。
    // ただし「眠っている順」は掘り起こしが目的なので、お気に入りを優遇しない。
    if (sort !== "dormant") {
      sorted.sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false));
    }
    return sorted;
  }, [wardrobeItems, category, genre, season, search, sort]);


  const thisSeason = seasonOfMonth(new Date().getMonth() + 1);

  // 選択中のアイテムが絞り込みで消えたら、一覧の先頭を選択中として扱う。
  const activeFeaturedId = filtered.some((i) => i.id === featuredId)
    ? featuredId
    : (filtered[0]?.id ?? null);

  // 初期投入分がイラスト(SVG)を指したまま残っているアカウントの検出。
  // イラストは配信を止めたので、この状態だと画像が全部壊れて表示される。
  const hasBrokenSeed = (items ?? []).some((i) => i.isSeed && i.imageUrl.endsWith(".svg"));

  async function reloadItems() {
    if (!user) return;
    const list = await listClosetItems(user.uid);
    setItems(list);
    setDormantBefore(Date.now() - DORMANT_MS);
  }

  /**
   * 見本の服を入れ直したあとの後始末。
   *
   * 入れた一式が表示中の一式と食い違うと、**入れたばかりの服が1着も出ない**ことになる
   * (例: 表示をウィメンズにしたままメンズの見本を入れる)。入れた内容に表示を合わせる。
   */
  async function applySeedResult(style: WardrobeStyle) {
    await reloadItems();
    chooseWardrobe(style === "both" ? "all" : style);
  }

  /**
   * クローゼットの書き出し。
   *
   * 写真そのものではなく URL を書き出す。画像を全部詰めると数十MBになり、
   * 端末によっては生成に失敗するため。機種変更や、うっかり消したときの保険という位置づけ。
   */
  function handleExport() {
    if (!items) return;
    downloadJson(
      {
        format: "my-clothes.closet.v1",
        exportedAt: new Date().toISOString(),
        items: items.map((i) => ({
          category: i.category,
          label: i.label,
          imageUrl: i.imageUrl,
          brand: i.brand ?? "",
          size: i.size ?? "",
          color: i.color ?? "",
          genres: i.genres ?? [],
          seasons: i.seasons ?? [],
          memo: i.memo ?? "",
          hashtags: i.hashtags ?? [],
          wardrobe: i.wardrobe ?? null,
          price: i.price ?? null,
          pricePublic: i.pricePublic ?? false,
          favorite: i.favorite ?? false,
        })),
      },
      `my-clothes-closet-${new Date().toISOString().slice(0, 10)}.json`
    );
    setIoNote(`${items.length}着を書き出しました。`);
    setTimeout(() => setIoNote(""), 3000);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: string;
        items?: {
          category: ClosetCategory;
          label: string;
          imageUrl: string;
          hashtags?: string[];
          wardrobe?: "men" | "women" | null;
        }[];
      };
      if (parsed.format !== "my-clothes.closet.v1" || !Array.isArray(parsed.items)) {
        throw new Error("このファイルは読み込めません。");
      }
      // 既存は消さずに足すだけ。読み込みで手持ちが消えるのが一番困るため。
      await addSeedClosetItems(
        user.uid,
        parsed.items.map((i) => ({
          category: i.category,
          label: i.label,
          imageUrl: i.imageUrl,
          hashtags: i.hashtags ?? [],
          wardrobe: i.wardrobe ?? undefined,
        }))
      );
      await reloadItems();
      setIoNote(`${parsed.items.length}着を読み込みました。`);
    } catch (err) {
      setIoNote(err instanceof Error ? err.message : "読み込みに失敗しました。");
    }
    setTimeout(() => setIoNote(""), 4000);
  }

  async function handleSaveEdit(patch: Partial<ClosetItem>) {
    if (!editing) return;
    await updateClosetItem(editing.id, patch);
    setItems((prev) => (prev ?? []).map((i) => (i.id === editing.id ? { ...i, ...patch } : i)));
    setEditing(null);
  }

  /** お気に入りの付け外し。画面は先に切り替え、保存は裏で行う。 */
  function handleToggleFavorite(item: ClosetItem) {
    const next = !item.favorite;
    setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? { ...i, favorite: next } : i)));
    void updateClosetItem(item.id, { favorite: next }).catch(() => {
      // 保存に失敗したら表示を元に戻す(黙って食い違ったままにしない)。
      setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? { ...i, favorite: !next } : i)));
    });
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
        {/* どの一式を出すか。既定はプロフィールの「主に使う服」で、ここで選び直すと
            その選択が端末に残る(リロードしても他の画面から戻っても引き継がれる)。
            「すべて表示」は末尾に置く(Kazさん指示 2026-08-05)。 */}
        {view === "items" && (
          <div className="mb-3">
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
              {wardrobeOrder.map((w) => (
                <Chip key={w} selected={wardrobe === w} onClick={() => chooseWardrobe(w)}>
                  {WARDROBE_LABELS[w]}
                  {wardrobeCount(w) !== null ? ` (${wardrobeCount(w)})` : ""}
                </Chip>
              ))}
              <Chip selected={wardrobe === "all"} onClick={() => chooseWardrobe("all")}>
                すべて表示{items ? ` (${items.length})` : ""}
              </Chip>
            </div>
            {wardrobe !== "all" && hasUnspecified && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                メンズ・ウィメンズを指定していない服は、どちらを選んでも表示されます。
              </p>
            )}
          </div>
        )}

        {/* アイテム(1着ずつ)とコーデ(保存した組み合わせ)の切り替え。 */}
        <div className="mb-3 flex gap-2">
          <Chip selected={view === "items"} onClick={() => setView("items")}>
            アイテム{wardrobeItems ? ` (${wardrobeItems.length})` : ""}
          </Chip>
          <Chip selected={view === "outfits"} onClick={() => setView("outfits")}>
            コーデ{savedOutfits ? ` (${savedOutfits.length})` : ""}
          </Chip>
        </div>

        {view === "outfits" ? (
          savedOutfits === null ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : savedOutfits.length === 0 ? (
            <EmptyState
              title="保存したコーデはまだありません"
              description="2択で「着る」と決めたあとに「コーデとして保存」すると、ここに並びます。保存したコーデは、次の2択を作るとき「まえのコーデ」からワンタップで呼び出せます。"
            />
          ) : (
            <div className="space-y-3">
              {savedOutfits.map((o) => {
                const oItems = o.itemIds
                  .map((id) => (items ?? []).find((i) => i.id === id))
                  .filter((i): i is ClosetItem => Boolean(i));
                return (
                  <div key={o.id} className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-3">
                    <div className="grid w-24 shrink-0 grid-cols-2 gap-0.5">
                      {oItems.slice(0, 4).map((item) => (
                        <span key={item.id} className="relative block aspect-square overflow-hidden rounded-md bg-surface-muted">
                          <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                        </span>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{o.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {oItems.length}アイテム
                        {o.lastWornAt ? ` ・ 最後に着たのは${timeAgo(o.lastWornAt)}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingOutfit(o);
                        setOutfitName(o.name);
                      }}
                      className="tappable shrink-0 text-xs font-bold text-accent"
                    >
                      編集
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <>
        {hasBrokenSeed && user && (
          <div className="mb-5 rounded-3xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm font-bold text-accent">初期クローゼットの写真を入れ替えられます</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              最初から入っていたイラストを、実際の服の写真に差し替えました。
              下から選んで入れ直してください。自分で登録した服はそのまま残ります。
            </p>
            <SeedClosetPicker uid={user.uid} onDone={applySeedResult} />
          </div>
        )}

        {/* 服が増えると絞り込みだけでは追いつかない。「あの黒いやつ」で引けるようにする。 */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前・ブランド・色で探す"
          className={`${inputClass} mb-2.5`}
        />

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

        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
          {SORT_LABELS.map((s) => (
            <Chip key={s.value} size="sm" selected={sort === s.value} onClick={() => setSort(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>

        {/* 持っているのに忘れている服を減らすのが、このアプリの裏の狙い。
            数を出して、そこから一覧に入れるようにしている。 */}
        {dormantCount > 0 && sort !== "dormant" && (
          <button
            type="button"
            onClick={() => setSort("dormant")}
            className="tappable mb-3 w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-left"
          >
            <span className="text-xs font-bold">1ヶ月以上着ていない服が{dormantCount}着あります</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              タップすると眠っている順に並べ替えます
            </span>
          </button>
        )}

        {/* 見本の服はいつでも入れ直せる。最初の一回きりにすると、
            消してしまった人やメンズ/レディースを選び直したい人が戻れなくなる。 */}
        <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
          <button type="button" onClick={handleExport} className="tappable text-[11px] font-bold text-accent">
            書き出す
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="tappable text-[11px] font-bold text-accent"
          >
            読み込む
          </button>
          <button
            type="button"
            onClick={() => setSeedSheetOpen(true)}
            className="tappable text-[11px] font-bold text-accent"
          >
            見本の服を入れる
          </button>
        </div>

        {ioNote && <p className="mb-4 text-[11px] text-muted-foreground">{ioNote}</p>}

        {/* カテゴリタブ。ワードローブの直上に置き、押してから左右にスライドすると
            そのカテゴリの服がレールの上を流れる(Kazさん指示 2026-08-04)。 */}
        <div className="no-scrollbar -mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4">
          <Chip selected={category === "all"} onClick={() => setCategory("all")}>
            すべて{wardrobeItems ? ` (${wardrobeItems.length})` : ""}
          </Chip>
          {CLOSET_CATEGORIES.map((c) => {
            const count = (wardrobeItems ?? []).filter((i) => i.category === c.value).length;
            if (count === 0 && category !== c.value) return null;
            return (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label} ({count})
              </Chip>
            );
          })}
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
              title={
                items.length === 0
                  ? "クローゼットが空です"
                  : wardrobeItems && wardrobeItems.length === 0
                    ? `${wardrobeLabel}の服はまだありません`
                    : "条件に合う服がありません"
              }
              description={
                items.length === 0
                  ? "買った服を先に登録しておくと、毎朝の組み合わせ選びが一気に速くなります。"
                  : wardrobeItems && wardrobeItems.length === 0
                    ? "上の「すべて表示」を押すと、登録してある服がすべて出ます。"
                    : "絞り込みを変えてみてください。"
              }
              action={
                items.length === 0 ? (
                  <Link href="/closet/add">
                    <PrimaryButton full={false}>最初の1着を登録</PrimaryButton>
                  </Link>
                ) : wardrobeItems && wardrobeItems.length === 0 ? (
                  <PrimaryButton full={false} onClick={() => chooseWardrobe("all")}>
                    すべて表示にする
                  </PrimaryButton>
                ) : undefined
              }
            />
            {items.length === 0 && user && (
              <div className="mt-4 rounded-3xl border border-border bg-surface p-4">
                <p className="text-sm font-bold">見本の服から始めることもできます</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  実際の服の写真を入れておけるので、自分の服を撮る前でも2択を試せます。
                </p>
                <SeedClosetPicker uid={user.uid} onDone={applySeedResult} />
              </div>
            )}
          </>
        ) : (
          <>
            {/* 参考画像(2026-08-04 Kazさん指定)のワードローブ表示。左右にスワイプすると
                服がレールの上を流れて選べる。下のカードをタップしても該当の服まで滑る。 */}
            <WardrobeCarousel
              items={filtered}
              featuredId={activeFeaturedId}
              onFeature={setFeaturedId}
              onEdit={(item) => setEditing(item)}
            />
            <ClosetCardGrid
              items={filtered}
              featuredId={activeFeaturedId}
              onSelect={(item) => setFeaturedId(item.id)}
              onToggleFavorite={handleToggleFavorite}
            />
          </>
        )}
          </>
        )}
      </div>

      <BottomSheet open={Boolean(editingOutfit)} onClose={() => setEditingOutfit(null)} title="コーデの編集">
        {editingOutfit && (
          <div className="pb-4">
            <Field label="コーデの名前">
              <input value={outfitName} onChange={(e) => setOutfitName(e.target.value)} maxLength={30} className={inputClass} />
            </Field>
            <div className="mb-3">
              <PrimaryButton
                onClick={async () => {
                  const name = outfitName.trim() || editingOutfit.name;
                  await updateSavedOutfit(editingOutfit.id, { name });
                  setSavedOutfits((prev) => (prev ?? []).map((o) => (o.id === editingOutfit.id ? { ...o, name } : o)));
                  setEditingOutfit(null);
                }}
              >
                保存する
              </PrimaryButton>
            </div>
            <SecondaryButton
              onClick={async () => {
                await deleteSavedOutfit(editingOutfit.id);
                setSavedOutfits((prev) => (prev ?? []).filter((o) => o.id !== editingOutfit.id));
                setEditingOutfit(null);
              }}
            >
              このコーデを削除(服そのものは残ります)
            </SecondaryButton>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(editing)} onClose={() => setEditing(null)} title="アイテムの情報">
        {editing && <EditItemForm item={editing} onSave={handleSaveEdit} onDelete={handleDelete} />}
      </BottomSheet>

      <BottomSheet open={seedSheetOpen} onClose={() => setSeedSheetOpen(false)} title="見本の服を入れる">
        {user && (
          <div className="pb-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              実際の服の写真をクローゼットに入れます。自分で登録した服はそのまま残り、
              前に入れた見本だけが選んだ内容に置き換わります。
            </p>
            <SeedClosetPicker
              uid={user.uid}
              onDone={async (style) => {
                await applySeedResult(style);
                setSeedSheetOpen(false);
              }}
            />
          </div>
        )}
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
function SeedClosetPicker({
  uid,
  onDone,
}: {
  uid: string;
  /** 入れた内容を渡す。呼び出し元がクローゼットの表示をそれに合わせられるようにするため。 */
  onDone: (style: WardrobeStyle) => Promise<void>;
}) {
  const [style, setStyle] = useState<WardrobeStyle>("women");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setWorking(true);
    setError(null);
    try {
      await replaceSeedClosetItems(uid, seedItemsFor(style));
      // 入れ直したら「主に使う服」もそれに合わせる。両方入れた人はウィメンズを主に
      // しておく(設定画面で変えられる)。
      await updateUserProfile(uid, { primaryWardrobe: style === "men" ? "men" : "women" });
      await onDone(style);
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
  const [price, setPrice] = useState(typeof item.price === "number" ? String(item.price) : "");
  const [pricePublic, setPricePublic] = useState(item.pricePublic ?? false);
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(item.wardrobe ?? null);
  const [bodyTypes, setBodyTypes] = useState<BodyType[]>(item.bodyTypes ?? []);
  const [genres, setGenres] = useState<StyleGenre[]>(item.genres ?? []);
  const [seasons, setSeasons] = useState<Season[]>(item.seasons ?? []);
  const [category, setCategory] = useState<ClosetCategory>(item.category);
  // この服に付けるハッシュタグ。投稿でこの服をタグ付けすると自動で引き継がれる。
  const [tagsText, setTagsText] = useState((item.hashtags ?? []).map((t) => `#${t}`).join(" "));
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

      <Field
        label="ハッシュタグ"
        hint="この服を投稿にタグ付けすると、ここのタグが自動で付きます。スペース区切り。"
      >
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="#白シャツ #きれいめ"
          className={inputClass}
        />
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

      <Field
        label="値段(任意)"
        hint="円で入力。「公開」にすると、この服入りのコーデを見た人が値段を見られます(無料は1日1コーデまで)。"
      >
        <div className="flex items-center gap-2">
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            placeholder="3990"
            className={`${inputClass} flex-1`}
          />
          <Chip size="sm" selected={pricePublic} onClick={() => setPricePublic((v) => !v)}>
            公開する
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

      <Field label="季節" hint="選ばなければ通年として扱います。">
        <div className="flex flex-wrap gap-2">
          {SEASONS.map((s) => (
            <Chip key={s.value} size="sm" selected={seasons.includes(s.value)} onClick={() => toggleSeason(s.value)}>
              {s.emoji} {s.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="メンズ / レディース" hint="指定なしなら常に表示されます。">
        <div className="flex flex-wrap gap-2">
          {(["women", "men"] as Wardrobe[]).map((w) => (
            <Chip key={w} size="sm" selected={wardrobe === w} onClick={() => setWardrobe(wardrobe === w ? null : w)}>
              {WARDROBE_LABELS[w]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="合う骨格タイプ(任意)" hint="自分の感覚でOK。2択を見る人に「骨格に合う服」の印が出ます。">
        <div className="flex flex-wrap gap-2">
          {BODY_TYPES.filter((b) => b.value !== "unknown").map((b) => (
            <Chip
              key={b.value}
              size="sm"
              selected={bodyTypes.includes(b.value)}
              onClick={() =>
                setBodyTypes((prev) =>
                  prev.includes(b.value) ? prev.filter((v) => v !== b.value) : [...prev, b.value]
                )
              }
            >
              {b.label}
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
            await onSave({
              label: label.trim(),
              brand,
              size,
              color,
              genres,
              seasons,
              category,
              hashtags: parseHashtags(tagsText),
              price: parsePrice(price),
              pricePublic,
              wardrobe,
              bodyTypes,
            });
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

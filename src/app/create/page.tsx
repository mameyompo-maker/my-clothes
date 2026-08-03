"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  countOutfitUndosToday,
  createOutfitPost,
  findTodaysOutfitPost,
  getFriendProfiles,
  hasCreatedOutfitToday,
  listClosetItems,
  listFacePatterns,
  undoOutfitPost,
  uploadImage,
} from "@/lib/firestore";
import { composeOutfitImage } from "@/lib/functions";
import { compressImage } from "@/lib/image";
import { suggestOutfit } from "@/lib/recommend";
import {
  BUILD_MODES,
  CATEGORY_ORDER,
  CLOSET_CATEGORIES,
  FREE_UNDO_PER_DAY,
  isPremium,
  otherWardrobe,
  WARDROBE_LABELS,
  wardrobeOfItem,
  type BuildMode,
  type ClosetCategory,
  type ClosetItem,
  type FacePattern,
  type OutfitCandidate,
  type UserProfile,
} from "@/types/models";
import { HangerRail } from "@/components/HangerRail";
import { WeatherBar } from "@/components/WeatherBar";
import { hasWeatherOptIn, loadTodayWeather, type TodayWeather } from "@/lib/weather";
import {
  ActionBar,
  Avatar,
  Chip,
  EmptyState,
  Field,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  TopBar,
  inputClass,
} from "@/components/ui";
import { IconCamera, IconCheck, IconChevronLeft, IconCloset, IconSparkles } from "@/components/icons";

type Slot = 0 | 1;
type Step = "mode" | "build" | "finish";

interface Draft {
  itemIdsByCategory: Partial<Record<ClosetCategory, string>>;
  facePatternId: string | null;
  liveCaptureFile: File | null;
  liveCapturePreviewUrl: string | null;
}

const emptyDraft = (): Draft => ({
  itemIdsByCategory: {},
  facePatternId: null,
  liveCaptureFile: null,
  liveCapturePreviewUrl: null,
});

export default function CreatePostPage() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  const [faces, setFaces] = useState<FacePattern[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [alreadyToday, setAlreadyToday] = useState(false);
  // 今日すでに取り消した回数。無料プランは FREE_UNDO_PER_DAY 回まで。
  const [undosToday, setUndosToday] = useState(0);
  const [undoing, setUndoing] = useState(false);
  // 「主に使う服」の反対側も出すか。既定は出さない。
  const [showOtherWardrobe, setShowOtherWardrobe] = useState(false);
  // その日の天気。提案の重みづけに使う。許可していなければ null のまま。
  const [weather, setWeather] = useState<TodayWeather | null>(null);

  const premium = isPremium(profile);
  const primaryWardrobe = profile?.primaryWardrobe ?? null;

  const [step, setStep] = useState<Step>("mode");
  const [buildMode, setBuildMode] = useState<BuildMode>("topDown");
  const [slot, setSlot] = useState<Slot>(0);
  const [drafts, setDrafts] = useState<[Draft, Draft]>([emptyDraft(), emptyDraft()]);
  // 通常は「次に埋めるべきカテゴリー」を自動で開く。ユーザーが自分でタブを触ったときだけ、
  // その選択を優先する(effect で同期すると余計な再描画が連鎖するので派生値にしている)。
  const [categoryOverride, setCategoryOverride] = useState<ClosetCategory | null>(null);

  const [mood, setMood] = useState("");
  const [note, setNote] = useState("");
  const [sharedWith, setSharedWith] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || !profile) return;
    Promise.all([
      listClosetItems(user.uid),
      listFacePatterns(user.uid),
      getFriendProfiles(profile.friendUids),
      hasCreatedOutfitToday(user.uid),
      countOutfitUndosToday(user.uid),
    ])
      .then(([items, f, fr, madeToday, undos]) => {
        setClosetItems(items);
        setFaces(f);
        setFriends(fr);
        setSharedWith(new Set(fr.map((x) => x.uid)));
        setAlreadyToday(madeToday);
        setUndosToday(undos);
      })
      .finally(() => setLoading(false));
  }, [user, profile]);

  // 天気は許可済みのときだけ黙って読む。ここで許可を求めることはしない
  // (求めるのは WeatherBar を本人が押したとき)。
  useEffect(() => {
    if (!hasWeatherOptIn()) return;
    loadTodayWeather()
      .then(setWeather)
      .catch(() => setWeather(null));
  }, []);

  /** 今日の2択を取り消して、もう一度作れる状態に戻す。 */
  async function handleUndoToday() {
    if (!user) return;
    setUndoing(true);
    setError("");
    try {
      const post = await findTodaysOutfitPost(user.uid);
      if (!post) {
        // 別の端末で先に取り消されていた場合。画面を実態に合わせるだけでよい。
        setAlreadyToday(false);
        return;
      }
      await undoOutfitPost(post.id);
      setUndosToday((n) => n + 1);
      setAlreadyToday(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取り消しに失敗しました。");
    } finally {
      setUndoing(false);
    }
  }

  const draft = drafts[slot];

  function updateDraft(target: Slot, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const next: [Draft, Draft] = [prev[0], prev[1]];
      next[target] = { ...next[target], ...patch };
      return next;
    });
  }

  /**
   * 服を選ぶ画面に出す一覧。
   *
   * 「主に使う服」に合う見本だけを既定で出す。メンズとウィメンズを両方入れている人は
   * 一覧が倍になって選びにくいため。自分で登録した服(wardrobe が付かない)は
   * どちらの設定でも常に出す——本人の服を隠す理由が無いので。
   */
  const visibleItems = useMemo(() => {
    if (!primaryWardrobe || showOtherWardrobe) return closetItems;
    return closetItems.filter((i) => {
      const w = wardrobeOfItem(i);
      return w === null || w === primaryWardrobe;
    });
  }, [closetItems, primaryWardrobe, showOtherWardrobe]);

  /** 反対側の見本を持っているときだけ、切り替えを出す意味がある。 */
  const hasOtherWardrobeItems = useMemo(() => {
    if (!primaryWardrobe) return false;
    return closetItems.some((i) => wardrobeOfItem(i) === otherWardrobe(primaryWardrobe));
  }, [closetItems, primaryWardrobe]);

  function toggleItem(item: ClosetItem) {
    const current = draft.itemIdsByCategory[item.category];
    const nextMap = { ...draft.itemIdsByCategory };
    if (current === item.id) delete nextMap[item.category];
    else nextMap[item.category] = item.id;
    updateDraft(slot, { itemIdsByCategory: nextMap });
  }

  function applySuggestion(target: Slot, hero?: ClosetItem | null) {
    // おまかせは「主に使う服」に従い、さらに今日の気温も見る。
    const suggestion = suggestOutfit(visibleItems, {
      maxTemp: weather?.maxTemp ?? null,
      favoriteGenres: profile?.favoriteGenres ?? [],
      heroItem: hero ?? null,
    });
    if (!suggestion) return;
    const map: Partial<Record<ClosetCategory, string>> = {};
    for (const item of suggestion.items) map[item.category] = item.id;
    updateDraft(target, { itemIdsByCategory: map });
  }

  function handleLiveCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    updateDraft(slot, {
      liveCaptureFile: file,
      liveCapturePreviewUrl: URL.createObjectURL(file),
      facePatternId: null,
    });
  }

  const selectedItems = (target: Slot) =>
    Object.values(drafts[target].itemIdsByCategory)
      .map((id) => closetItems.find((i) => i.id === id))
      .filter((i): i is ClosetItem => Boolean(i));

  const slotReady = (target: Slot) => Object.keys(drafts[target].itemIdsByCategory).length > 0;
  const bothReady = slotReady(0) && slotReady(1);
  const canSubmit = Boolean(user && bothReady && mood.trim() && !submitting);

  // 「上から順」モードでまだ埋まっていない一番上のカテゴリー。次に選ぶべき場所を示す。
  const nextCategory = useMemo(() => {
    const hasOnepiece = Boolean(draft.itemIdsByCategory.onepiece);
    return (
      CATEGORY_ORDER.find((c) => {
        if (draft.itemIdsByCategory[c]) return false;
        if ((c === "tops" || c === "bottoms") && hasOnepiece) return false;
        if (c === "onepiece" && (draft.itemIdsByCategory.tops || draft.itemIdsByCategory.bottoms)) return false;
        return closetItems.some((i) => i.category === c);
      }) ?? null
    );
  }, [draft.itemIdsByCategory, closetItems]);

  const activeCategory: ClosetCategory =
    categoryOverride ?? (buildMode === "topDown" && nextCategory ? nextCategory : "tops");

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

      const post = await createOutfitPost(
        user.uid,
        mood.trim(),
        note.trim(),
        candidates,
        Array.from(sharedWith),
        buildMode
      );

      // AI合成は課金状況に左右されるので、失敗しても投稿は成立させる。
      // 合成できない間は顔写真+服の写真をそのまま並べて表示する(OutfitCard)。
      void Promise.allSettled(
        candidates.map((_, index) => composeOutfitImage({ postId: post.id, candidateIndex: index }))
      );

      router.push("/vote");
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿に失敗しました。");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <TopBar title="コーデを作る" />
        <div className="mx-auto max-w-lg px-4 pt-10 text-center text-sm text-muted-foreground">読み込み中…</div>
      </>
    );
  }

  if (closetItems.length === 0) {
    return (
      <>
        <TopBar title="コーデを作る" />
        <div className="mx-auto max-w-lg px-4 pb-28 pt-8">
          <EmptyState
            icon={<IconCloset className="h-10 w-10" />}
            title="先にクローゼットを作りましょう"
            description="持っている服を登録すると、そこから2択のコーデを組めるようになります。"
            action={
              <Link href="/closet/add">
                <PrimaryButton full={false}>服を登録する</PrimaryButton>
              </Link>
            }
          />
        </div>
      </>
    );
  }

  // 2択は1日1回まで。朝に決め切る運用に寄せるための制限。
  // ただし作り直したくなることはあるので、取り消しを用意している(無料は1日1回まで)。
  if (alreadyToday) {
    const canUndo = premium || undosToday < FREE_UNDO_PER_DAY;
    return (
      <>
        <TopBar title="コーデを作る" />
        <div className="mx-auto max-w-lg px-4 pb-28 pt-8">
          <EmptyState
            icon={<IconCheck className="h-10 w-10" />}
            title="今日の2択はもう作りました"
            description="2択を作れるのは1日1回です。作った2択の結果を見るか、着たコーデを写真で残しましょう。また明日どうぞ。"
            action={
              <div className="flex w-full flex-col gap-2">
                <Link href="/vote">
                  <PrimaryButton>今日の2択を見る</PrimaryButton>
                </Link>
                <Link href="/post/new">
                  <SecondaryButton>全身写真を投稿する</SecondaryButton>
                </Link>
              </div>
            }
          />

          <div className="mt-4 rounded-3xl border border-border bg-surface p-4">
            <p className="text-sm font-bold">作り直したいときは</p>
            {canUndo ? (
              <>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  今日の2択を取り消すと、もう一度作れます。
                  {premium
                    ? "プレミアムなので何回でも取り消せます。"
                    : `無料プランで取り消せるのは1日${FREE_UNDO_PER_DAY}回までです。`}
                  <br />
                  取り消すと、友達がくれた投票も一緒に消えます。
                </p>
                <div className="mt-3">
                  <SecondaryButton onClick={handleUndoToday} disabled={undoing}>
                    {undoing ? "取り消しています…" : "今日の2択を取り消してやり直す"}
                  </SecondaryButton>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  今日ぶんの取り消しは使い切りました。明日また取り消せます。
                  プレミアムなら、何回でも取り消してやり直せます。
                </p>
                <div className="mt-3">
                  <Link href="/upgrade">
                    <SecondaryButton>プレミアムを見る</SecondaryButton>
                  </Link>
                </div>
              </>
            )}
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>
        </div>
      </>
    );
  }

  // ---------------- Step 1: 決め方を選ぶ ----------------
  if (step === "mode") {
    return (
      <>
        <TopBar title="コーデを作る" />
        <div className="mx-auto max-w-lg px-4 pb-28 pt-6">
          <h2 className="mb-1 text-xl font-bold tracking-tight">今日はどう決める?</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            迷う時間を減らすのが目的なので、決め方から選べるようにしています。
          </p>

          {/* 服を選ぶ前に気温を知っておくと、選び直しが減る。 */}
          <div className="mb-6">
            <WeatherBar />
          </div>

          <div className="space-y-3">
            {BUILD_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  setBuildMode(m.value);
                  setStep("build");
                }}
                className="tappable w-full rounded-3xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-card)]"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-base font-bold">{m.label}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{m.description}</p>
              </button>
            ))}

            {premium ? (
              <button
                onClick={() => {
                  setBuildMode("topDown");
                  applySuggestion(0);
                  applySuggestion(1);
                  setStep("finish");
                }}
                className="tappable flex w-full items-center gap-3 rounded-3xl border border-accent/40 bg-accent-soft p-5 text-left"
              >
                <IconSparkles className="h-6 w-6 shrink-0 text-accent" />
                <div>
                  <span className="block text-base font-bold text-accent">おまかせで2択を作る</span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    季節と好みと着ていない期間から、2パターン自動で組みます
                  </p>
                </div>
              </button>
            ) : (
              <Link
                href="/upgrade"
                className="tappable flex w-full items-center gap-3 rounded-3xl border border-border bg-surface p-5 text-left"
              >
                <IconSparkles className="h-6 w-6 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="block text-base font-bold">おまかせで2択を作る</span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    自動で組む機能はプレミアム向けです。上の2つは無料で使えます
                  </p>
                </div>
              </Link>
            )}
          </div>
        </div>
      </>
    );
  }

  // ---------------- Step 2: 服を選ぶ ----------------
  if (step === "build") {
    const itemsForPicker =
      buildMode === "hero" && !slotReady(slot)
        ? visibleItems
        : visibleItems.filter((i) => i.category === activeCategory);

    return (
      <>
        <TopBar
          title="服を選ぶ"
          left={
            <IconButton label="戻る" onClick={() => setStep("mode")}>
              <IconChevronLeft className="h-5 w-5" />
            </IconButton>
          }
          right={
            <button
              onClick={() => setStep("finish")}
              disabled={!bothReady}
              className="text-sm font-bold text-accent disabled:text-muted-foreground/50"
            >
              次へ
            </button>
          }
        />

        <div className="mx-auto max-w-lg px-4 pb-28 pt-4">
          <div className="mb-4 flex gap-2">
            {([0, 1] as Slot[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSlot(s);
                  setCategoryOverride(null);
                }}
                className={`tappable flex-1 rounded-2xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                  slot === s ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-muted-foreground"
                }`}
              >
                候補{s === 0 ? "A" : "B"} {slotReady(s) ? "✓" : ""}
              </button>
            ))}
          </div>

          <div className="mb-4 min-h-[54px] rounded-2xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">選んだアイテム</span>
              {premium ? (
                <button
                  onClick={() => applySuggestion(slot)}
                  className="flex items-center gap-1 text-[11px] font-bold text-accent"
                >
                  <IconSparkles className="h-3.5 w-3.5" /> おまかせ
                </button>
              ) : (
                <Link href="/upgrade" className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                  <IconSparkles className="h-3.5 w-3.5" /> おまかせ
                </Link>
              )}
            </div>
            {selectedItems(slot).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {buildMode === "hero" ? "今日いちばん着たい1着を選んでください" : "下から服を選んでください"}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedItems(slot).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item)}
                    className="tappable rounded-full bg-surface-muted px-2.5 py-1 text-[11px]"
                  >
                    {item.label} ×
                  </button>
                ))}
              </div>
            )}
          </div>

          {buildMode === "hero" && !slotReady(slot) ? (
            <>
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                {premium
                  ? "主役を1着えらぶと、残りは自動で提案します"
                  : "今日いちばん着たい1着をえらんでください"}
              </p>
              <HangerRail
                items={visibleItems}
                selectedIds={Object.values(draft.itemIdsByCategory) as string[]}
                onSelect={(item) => {
                  // 残りを自動で埋めるのはプレミアム機能。無料では主役だけ置いて、
                  // あとはカテゴリー別に自分で選んでもらう。
                  if (premium) applySuggestion(slot, item);
                  else toggleItem(item);
                }}
              />
            </>
          ) : (
            <>
              <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
                {CLOSET_CATEGORIES.filter((c) => visibleItems.some((i) => i.category === c.value)).map((c) => (
                  <Chip key={c.value} selected={activeCategory === c.value} onClick={() => setCategoryOverride(c.value)}>
                    {c.label}
                    {draft.itemIdsByCategory[c.value] ? " ✓" : ""}
                    {buildMode === "topDown" && nextCategory === c.value ? " ←今ここ" : ""}
                  </Chip>
                ))}
              </div>

              {itemsForPicker.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">このカテゴリーの服がありません。</p>
              ) : (
                <HangerRail
                  items={itemsForPicker}
                  selectedIds={Object.values(draft.itemIdsByCategory) as string[]}
                  onSelect={toggleItem}
                />
              )}
            </>
          )}

          {/* 反対側の見本への切り替え。一覧の末尾に置いて、普段は視界に入らないようにする。 */}
          {hasOtherWardrobeItems && primaryWardrobe && (
            <div className="mt-6 flex justify-center border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowOtherWardrobe((v) => !v)}
                className="tappable text-xs font-bold text-accent"
              >
                {showOtherWardrobe
                  ? `${WARDROBE_LABELS[primaryWardrobe]}の服だけに戻す`
                  : `${WARDROBE_LABELS[otherWardrobe(primaryWardrobe)]}の服も見る`}
              </button>
            </div>
          )}
        </div>

        <ActionBar>
          {!slotReady(1) && slotReady(0) ? (
            <PrimaryButton onClick={() => setSlot(1)}>候補Bを作る</PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => setStep("finish")} disabled={!bothReady}>
              次へ(顔と気分)
            </PrimaryButton>
          )}
        </ActionBar>
      </>
    );
  }

  // ---------------- Step 3: 顔・気分・共有 ----------------
  return (
    <>
      <TopBar
        title="仕上げ"
        left={
          <IconButton label="戻る" onClick={() => setStep("build")}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
        <div className="mb-6 grid grid-cols-2 gap-3">
          {([0, 1] as Slot[]).map((s) => (
            <div key={s} className="rounded-2xl border border-border bg-surface p-2">
              <p className="mb-1.5 text-center text-xs font-bold">候補{s === 0 ? "A" : "B"}</p>
              <div className="grid grid-cols-2 gap-1">
                {selectedItems(s)
                  .slice(0, 4)
                  .map((item) => (
                    <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface-muted">
                      <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-bold">今日の顔(任意)</h2>
            <span className="text-[11px] text-muted-foreground">候補{slot === 0 ? "A" : "B"}に設定</span>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            登録すると投稿カードに一緒に表示されます。AI合成が使えるときは、この顔で着用イメージも作ります。
          </p>

          <div className="mb-2 flex gap-2">
            {([0, 1] as Slot[]).map((s) => (
              <Chip key={s} size="sm" selected={slot === s} onClick={() => setSlot(s)}>
                候補{s === 0 ? "A" : "B"}
              </Chip>
            ))}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleLiveCapture} />
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`tappable relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-dashed ${
                draft.liveCaptureFile ? "border-accent text-accent" : "border-border text-muted-foreground"
              }`}
            >
              {draft.liveCapturePreviewUrl ? (
                <Image src={draft.liveCapturePreviewUrl} alt="撮影した顔" fill className="object-cover" unoptimized />
              ) : (
                <>
                  <IconCamera className="h-5 w-5" />
                  <span className="text-[10px]">撮影</span>
                </>
              )}
            </button>
            {faces.map((f) => (
              <button
                key={f.id}
                onClick={() => updateDraft(slot, { facePatternId: f.id, liveCaptureFile: null, liveCapturePreviewUrl: null })}
                className={`tappable relative aspect-square overflow-hidden rounded-2xl ring-2 ${
                  draft.facePatternId === f.id ? "ring-accent" : "ring-transparent"
                }`}
              >
                <Image src={f.imageUrl} alt={f.label} fill className="object-cover" unoptimized />
              </button>
            ))}
          </div>
        </div>

        <Field label="今日の気分・予定">
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            placeholder="例: 今日はデート、ちょっと気合い入れたい"
            className={inputClass}
          />
        </Field>

        <Field label="ひとこと(任意)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </Field>

        <h2 className="mb-2 text-sm font-bold">誰に選んでもらう?</h2>
        {friends.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              まだ友達がいません。友達がいなくても投稿は保存でき、あとから自分で選べます。
            </p>
            <Link href="/profile">
              <SecondaryButton>友達を追加する</SecondaryButton>
            </Link>
          </div>
        ) : (
          <div className="mb-4 space-y-2">
            {friends.map((f) => (
              <label
                key={f.uid}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5"
              >
                <input
                  type="checkbox"
                  checked={sharedWith.has(f.uid)}
                  onChange={() =>
                    setSharedWith((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.uid)) next.delete(f.uid);
                      else next.add(f.uid);
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <Avatar src={f.avatarUrl} name={f.name} size={30} />
                <span className="text-sm">{f.name}</span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      </div>

      <ActionBar>
        <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? "投稿中…" : friends.length === 0 ? "2択を保存する" : "投稿して選んでもらう"}
        </PrimaryButton>
        {!mood.trim() && bothReady && (
          <p className="pt-2 text-center text-[11px] text-muted-foreground">
            「今日の気分・予定」を入れると投稿できます
          </p>
        )}
      </ActionBar>
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createOutfitPost,
  findTodaysOutfitPost,
  getFriendProfiles,
  listClosetItems,
  listFacePatterns,
  listSavedOutfits,
  loadMyOutfitState,
  undoOutfitPost,
  updateUserProfile,
  uploadImage,
} from "@/lib/firestore";
import {
  composeOutfitImage,
  isAiComposeEnabled,
  precomposeOutfit,
  suggestOutfitPair,
} from "@/lib/functions";
import { compressImage } from "@/lib/image";
import { suggestOutfit } from "@/lib/recommend";
import {
  BUILD_MODES,
  CATEGORY_ORDER,
  CLOSET_CATEGORIES,
  FREE_UNDO_PER_DAY,
  isPremium,
  otherWardrobe,
  outfitSignature,
  SEASONS,
  STYLE_GENRES,
  WARDROBE_LABELS,
  wardrobeOfItem,
  type BuildMode,
  type ClosetCategory,
  type ClosetItem,
  type FacePattern,
  type FriendGroup,
  type OutfitCandidate,
  type PostVisibility,
  type Season,
  type StyleGenre,
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
import { IconCamera, IconCheck, IconChevronLeft, IconCloset, IconSparkles, IconX } from "@/components/icons";

type Slot = 0 | 1;
type Step = "mode" | "build" | "finish";

interface Draft {
  itemIdsByCategory: Partial<Record<ClosetCategory, string>>;
  facePatternId: string | null;
  liveCaptureFile: File | null;
  liveCapturePreviewUrl: string | null;
  /** 服の組み合わせの代わりに「いま撮った全身写真」で出す候補(2026-08-04 追加)。 */
  outfitPhotoFile: File | null;
  outfitPhotoPreviewUrl: string | null;
}

const emptyDraft = (): Draft => ({
  itemIdsByCategory: {},
  facePatternId: null,
  liveCaptureFile: null,
  liveCapturePreviewUrl: null,
  outfitPhotoFile: null,
  outfitPhotoPreviewUrl: null,
});

/** 「まえのコーデ」1件。保存コーデ(名前つき)と、過去に着た組み合わせの両方が入る。 */
interface QuickCombo {
  key: string;
  name: string | null;
  itemIds: string[];
  /** 最後に着てから何日か。null は未着用。読み込み時に計算して固定する。 */
  daysAgo: number | null;
}

export default function CreatePostPage() {
  const { user, profile, refreshProfile, hasAiKey, hasStylistKey } = useAuth();
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
  // まえのコーデ(保存コーデ+過去に着た組み合わせ)。パッと選んで組み直しを省くための一覧。
  const [quickCombos, setQuickCombos] = useState<QuickCombo[]>([]);
  // 服選びの絞り込み(季節・ジャンル・色)。「あの色のやつ」をすぐ出すため。
  const [filterSeason, setFilterSeason] = useState<Season | null>(null);
  const [filterGenre, setFilterGenre] = useState<StyleGenre | null>(null);
  const [filterColor, setFilterColor] = useState<string | null>(null);
  // 共有相手のグループ保存
  const [groupName, setGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const outfitPhotoInputRef = useRef<HTMLInputElement>(null);

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
  // 2択の公開範囲。既定は友達だけ(いきなり全体公開されると驚くため)。
  const [outfitVisibility, setOutfitVisibility] = useState<PostVisibility>("friends");
  const [submitting, setSubmitting] = useState(false);
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);
  const [aiSuggestError, setAiSuggestError] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- AI合成の先行実行。仕上げステップに入った時点で裏で合成を始めておき、
  // 気分や共有相手を入力している時間で「合成待ち」を吸収する。
  // キー(署名)は「服の組み合わせ+顔」。署名→合成済みURL。
  const [precomposed, setPrecomposed] = useState<Record<string, string>>({});
  // 一度発火した署名。失敗しても再発火しない(投稿時の通常ルートが拾い直すため)。
  const precomposeStarted = useRef<Set<string>>(new Set());
  // 撮影した顔写真のアップロード結果。同じファイルの二重アップロードを防ぐ。
  const liveUploads = useRef<Map<File, Promise<string>>>(new Map());

  function draftSignature(d: Draft): string | null {
    // 全身写真で出す候補はAI合成をしない(写真そのものを見せる)。
    if (d.outfitPhotoFile) return null;
    const itemIds = Object.values(d.itemIdsByCategory);
    if (itemIds.length === 0) return null;
    const face = d.liveCaptureFile
      ? `live:${d.liveCaptureFile.name}:${d.liveCaptureFile.size}:${d.liveCaptureFile.lastModified}`
      : d.facePatternId
        ? `face:${d.facePatternId}`
        : null;
    // 顔が無い候補は合成対象にならない(合成には顔写真が必須)。
    if (!face) return null;
    return `${face}|${[...itemIds].sort().join(",")}`;
  }

  function uploadLiveCapture(file: File, uid: string): Promise<string> {
    let p = liveUploads.current.get(file);
    if (!p) {
      p = compressImage(file).then((blob) => uploadImage(`outfits/${uid}/${crypto.randomUUID()}.jpg`, blob));
      liveUploads.current.set(file, p);
    }
    return p;
  }

  useEffect(() => {
    if (!user || !profile) return;
    // 自分の2択まわりは1本にまとめて引く(以前は同じクエリを3回投げていた)。
    Promise.all([
      listClosetItems(user.uid),
      listFacePatterns(user.uid),
      getFriendProfiles(profile.friendUids),
      loadMyOutfitState(user.uid),
      listSavedOutfits(user.uid),
    ])
      .then(([items, f, fr, outfitState, saved]) => {
        const { madeToday, undosToday: undos, posts: pastPosts } = outfitState;
        setClosetItems(items);
        setFaces(f);
        setFriends(fr);
        setSharedWith(new Set(fr.map((x) => x.uid)));
        setAlreadyToday(madeToday);
        setUndosToday(undos);

        // 「まえのコーデ」を組み立てる。保存コーデ(名前つき)を先に置き、
        // 過去の2択で「着る」と確定した組み合わせを署名で重複排除しながら足す。
        // 何日前に着たかを一緒に出すことで、コーデ被りにその場で気付ける。
        const now = Date.now();
        const bySig = new Map<string, QuickCombo & { lastWornAt: number | null }>();
        for (const so of saved) {
          bySig.set(outfitSignature(so.itemIds), {
            key: so.id,
            name: so.name,
            itemIds: so.itemIds,
            daysAgo: null,
            lastWornAt: so.lastWornAt ?? null,
          });
        }
        for (const post of pastPosts) {
          const d = post.decidedCandidateIndex;
          if (d === null || d === undefined) continue;
          const cand = post.candidates[d];
          if (!cand || cand.itemIds.length === 0) continue;
          const sig = outfitSignature(cand.itemIds);
          const existing = bySig.get(sig);
          if (existing) {
            existing.lastWornAt = Math.max(existing.lastWornAt ?? 0, post.createdAt);
          } else {
            bySig.set(sig, { key: sig, name: null, itemIds: cand.itemIds, daysAgo: null, lastWornAt: post.createdAt });
          }
        }
        const combos = Array.from(bySig.values())
          .map((c) => ({
            ...c,
            daysAgo: c.lastWornAt ? Math.max(0, Math.floor((now - c.lastWornAt) / 86400000)) : null,
          }))
          .sort((a, b) => (b.lastWornAt ?? 0) - (a.lastWornAt ?? 0))
          .slice(0, 12);
        setQuickCombos(combos);
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

  // 仕上げステップに入ったら、確定している候補のAI合成を先に始める。
  // 発火は仕上げステップ限定にしてある: 服選びの途中で発火すると、選び直すたびに
  // 使われない合成が走ってトークンを無駄にするため。ここなら組み合わせはほぼ確定している。
  useEffect(() => {
    // AI合成は本人が自分のAPIキーを登録しているときだけ走らせる。
    // 未登録で叩いても関数側で failed-precondition になるだけなので、発火させない。
    if (!isAiComposeEnabled || !hasAiKey || step !== "finish" || !user) return;
    for (const d of drafts) {
      const sig = draftSignature(d);
      if (!sig || precomposeStarted.current.has(sig)) continue;
      precomposeStarted.current.add(sig);
      void (async () => {
        try {
          let liveCaptureUrl: string | null = null;
          if (d.liveCaptureFile) liveCaptureUrl = await uploadLiveCapture(d.liveCaptureFile, user.uid);
          const { composedImageUrl } = await precomposeOutfit({
            itemIds: Object.values(d.itemIdsByCategory) as string[],
            facePatternId: d.liveCaptureFile ? null : d.facePatternId,
            liveCaptureUrl,
          });
          setPrecomposed((prev) => ({ ...prev, [sig]: composedImageUrl }));
        } catch {
          // 失敗してもここでは何もしない。投稿時の通常ルート(composeOutfitImage)が
          // もう一度試すので、先行合成の失敗が投稿を妨げることはない。
        }
      })();
    }
    // drafts の変更(顔の選び直しなど)でも再評価する。署名が変わった候補だけ新たに発火する。
  }, [step, drafts, user, hasAiKey]);

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
    const base =
      !primaryWardrobe || showOtherWardrobe
        ? closetItems
        : closetItems.filter((i) => {
            const w = wardrobeOfItem(i);
            return w === null || w === primaryWardrobe;
          });
    // クローゼットで星を付けたお気に入りを先頭に出す。よく着る服ほど早く手に取れる
    // ようにして選ぶ時間を削る。安定ソートなので元の並び(登録順)は崩れない。
    return [...base].sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false));
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

  /** まえのコーデをそのまま今の候補に流し込む。組み直しの手間を丸ごと省く。 */
  function applyCombo(combo: QuickCombo) {
    const map: Partial<Record<ClosetCategory, string>> = {};
    for (const id of combo.itemIds) {
      const item = closetItems.find((i) => i.id === id);
      if (item) map[item.category] = item.id;
    }
    if (Object.keys(map).length === 0) return;
    updateDraft(slot, { itemIdsByCategory: map, outfitPhotoFile: null, outfitPhotoPreviewUrl: null });
  }

  function handleOutfitPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    updateDraft(slot, {
      outfitPhotoFile: file,
      outfitPhotoPreviewUrl: URL.createObjectURL(file),
    });
  }

  /** 服選びの絞り込み(季節・ジャンル・色)。季節タグ未設定は通年扱いで残す。 */
  function matchesFilters(i: ClosetItem): boolean {
    if (filterSeason && (i.seasons ?? []).length > 0 && !(i.seasons ?? []).includes(filterSeason)) return false;
    if (filterGenre && !(i.genres ?? []).includes(filterGenre)) return false;
    if (filterColor && (i.color ?? "").trim() !== filterColor) return false;
    return true;
  }

  function applySuggestion(target: Slot, hero?: ClosetItem | null) {
    // おまかせは「主に使う服」に従い、さらに今日の気温も見る。
    const suggestion = suggestOutfit(visibleItems, {
      maxTemp: weather?.maxTemp ?? null,
      favoriteGenres: profile?.favoriteGenres ?? [],
      heroItem: hero ?? null,
      bodyType: profile?.bodyType ?? null,
    });
    if (!suggestion) return;
    const map: Partial<Record<ClosetCategory, string>> = {};
    for (const item of suggestion.items) map[item.category] = item.id;
    updateDraft(target, { itemIdsByCategory: map });
  }

  /**
   * Claude に2択そのものを考えてもらう。
   *
   * 「おまかせ」との違いは中身の決め方。おまかせは季節・ジャンル・着ていない期間の
   * ルールで選ぶだけだが、こちらは色の相性や本人の骨格まで見たうえで、
   * **方向性の違う2案**を返してくる。画像は作らない(それは合成側の担当)。
   */
  async function handleAiSuggest() {
    if (aiSuggestBusy) return;
    setAiSuggestBusy(true);
    setAiSuggestError("");
    try {
      const candidates = await suggestOutfitPair();
      setBuildMode("topDown");
      candidates.slice(0, 2).forEach((c, index) => {
        const map: Partial<Record<ClosetCategory, string>> = {};
        for (const id of c.itemIds) {
          const item = closetItems.find((it) => it.id === id);
          if (item) map[item.category] = item.id;
        }
        updateDraft(index as Slot, { itemIdsByCategory: map });
      });
      // 本人がまだ気分を書いていないときだけ、提案の名前を初期値として入れる。
      if (!mood.trim() && candidates[0]?.label) setMood(candidates[0].label);
      setStep("finish");
    } catch (err) {
      setAiSuggestError(err instanceof Error ? err.message : "提案を受け取れませんでした。");
    } finally {
      setAiSuggestBusy(false);
    }
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

  // 候補は「服の組み合わせ」か「全身写真」のどちらかがあれば成立する。
  const slotReady = (target: Slot) =>
    Object.keys(drafts[target].itemIdsByCategory).length > 0 || drafts[target].outfitPhotoFile !== null;

  // 手持ちの服の色から絞り込み候補を作る(登録数が多い色から最大8つ)。
  const colorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of visibleItems) {
      const c = (i.color ?? "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c]) => c);
  }, [visibleItems]);
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
          // 先行合成が既にアップロードしていれば同じURLを使い回す。
          // ここで別のURLに上げ直すと合成キャッシュのキーが変わり、ヒットしなくなる。
          liveCaptureUrl = await uploadLiveCapture(d.liveCaptureFile, user.uid);
        }
        // 全身写真の候補。写真そのものを見せるので、AI合成はせず ready で作る。
        let photoUrl: string | null = null;
        if (d.outfitPhotoFile) {
          const compressed = await compressImage(d.outfitPhotoFile);
          photoUrl = await uploadImage(`outfits/${user.uid}/${crypto.randomUUID()}.jpg`, compressed);
        }
        const sig = draftSignature(d);
        const readyUrl = sig ? precomposed[sig] : undefined;
        candidates.push({
          itemIds: Object.values(d.itemIdsByCategory) as string[],
          facePatternId: liveCaptureUrl ? null : d.facePatternId,
          liveCaptureUrl,
          photoUrl,
          // 先行合成が終わっていれば、投稿の時点で合成済みとして作る(待ち時間ゼロ)。
          composedImageUrl: readyUrl ?? null,
          composeStatus: photoUrl || readyUrl ? "ready" : "pending",
        });
      }

      const post = await createOutfitPost(
        user.uid,
        mood.trim(),
        note.trim(),
        candidates,
        Array.from(sharedWith),
        buildMode,
        outfitVisibility
      );

      // AI合成は本人のAPIキーで走る。失敗しても投稿は成立させる。
      // 合成できない間は顔写真+服の写真をそのまま並べて表示する(OutfitCard)。
      // 先行合成が済んでいない候補だけ通常ルートで合成する。先行合成が処理中なら
      // サーバー側のキャッシュロックが待ち合わせるので、二重にGeminiを呼ぶことはない。
      if (isAiComposeEnabled && hasAiKey) {
        const pendingIndexes = candidates
          .map((c, index) => (c.composeStatus === "pending" ? index : -1))
          .filter((index) => index >= 0);
        void Promise.allSettled(
          pendingIndexes.map((index) => composeOutfitImage({ postId: post.id, candidateIndex: index }))
        );
      }

      router.push("/vote");
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿に失敗しました。");
      setSubmitting(false);
    }
  }

  /** グループの共有相手をそのまま適用する(友達でなくなった人は黙って外す)。 */
  function applyGroup(g: FriendGroup) {
    setSharedWith(new Set(g.memberUids.filter((u) => friends.some((f) => f.uid === u))));
  }

  async function saveGroup() {
    if (!user || !profile || !groupName.trim() || sharedWith.size === 0) return;
    setGroupBusy(true);
    try {
      const next: FriendGroup[] = [
        ...(profile.friendGroups ?? []),
        { id: crypto.randomUUID(), name: groupName.trim().slice(0, 20), memberUids: Array.from(sharedWith) },
      ];
      await updateUserProfile(user.uid, { friendGroups: next });
      await refreshProfile();
      setGroupName("");
    } finally {
      setGroupBusy(false);
    }
  }

  async function removeGroup(g: FriendGroup) {
    if (!user || !profile) return;
    setGroupBusy(true);
    try {
      await updateUserProfile(user.uid, {
        friendGroups: (profile.friendGroups ?? []).filter((x) => x.id !== g.id),
      });
      await refreshProfile();
    } finally {
      setGroupBusy(false);
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
                  取り消すと、もらった投票も一緒に消えます。
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

            {/* Claude に2択そのものを考えてもらう。キーを登録した人にだけ出す
                (未登録の人に押させても失敗するだけなので、導線ごと出さない)。 */}
            {hasStylistKey && (
              <button
                onClick={handleAiSuggest}
                disabled={aiSuggestBusy}
                className="tappable flex w-full items-center gap-3 rounded-3xl border border-accent bg-surface p-5 text-left disabled:opacity-60"
              >
                <IconSparkles
                  className={`h-6 w-6 shrink-0 text-accent ${aiSuggestBusy ? "animate-pulse" : ""}`}
                />
                <div>
                  <span className="block text-base font-bold text-accent">
                    {aiSuggestBusy ? "AIが考えています…" : "AIに2択を考えてもらう"}
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    色の相性や骨格まで見て、方向性の違う2案を組みます
                  </p>
                </div>
              </button>
            )}

            {aiSuggestError && (
              <p className="rounded-2xl border border-danger/40 bg-danger/5 p-3 text-[11px] leading-relaxed text-danger">
                {aiSuggestError}
              </p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ---------------- Step 2: 服を選ぶ ----------------
  if (step === "build") {
    const itemsForPicker = (
      buildMode === "hero" && !slotReady(slot)
        ? visibleItems
        : visibleItems.filter((i) => i.category === activeCategory)
    ).filter(matchesFilters);

    // 季節・ジャンル・色の絞り込みチップ。「あの色のやつ」をすぐ出すための行。
    const filterRows = (
      <>
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          {SEASONS.map((s) => (
            <Chip
              key={s.value}
              size="sm"
              selected={filterSeason === s.value}
              onClick={() => setFilterSeason(filterSeason === s.value ? null : s.value)}
            >
              {s.emoji} {s.label}
            </Chip>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
          {STYLE_GENRES.map((g) => (
            <Chip
              key={g.value}
              size="sm"
              selected={filterGenre === g.value}
              onClick={() => setFilterGenre(filterGenre === g.value ? null : g.value)}
            >
              {g.label}
            </Chip>
          ))}
        </div>
        {colorOptions.length > 0 && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {colorOptions.map((c) => (
              <Chip
                key={c}
                size="sm"
                selected={filterColor === c}
                onClick={() => setFilterColor(filterColor === c ? null : c)}
              >
                🎨 {c}
              </Chip>
            ))}
          </div>
        )}
      </>
    );

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

          {/* まえのコーデからパッと選ぶ。「◯日前に着た」で被りにも気付ける。 */}
          {quickCombos.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">まえのコーデからパッと選ぶ</p>
              <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4">
                {quickCombos.map((combo) => {
                  const comboItems = combo.itemIds
                    .map((id) => closetItems.find((i) => i.id === id))
                    .filter((i): i is ClosetItem => Boolean(i));
                  if (comboItems.length === 0) return null;
                  const recent = combo.daysAgo !== null && combo.daysAgo <= 7;
                  return (
                    <button
                      key={combo.key}
                      onClick={() => applyCombo(combo)}
                      className="tappable w-28 shrink-0 rounded-2xl border border-border bg-surface p-1.5 text-left"
                    >
                      <span className="grid grid-cols-2 gap-0.5">
                        {comboItems.slice(0, 4).map((item) => (
                          <span key={item.id} className="relative block aspect-square overflow-hidden rounded-md bg-surface-muted">
                            <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                          </span>
                        ))}
                      </span>
                      <span className="mt-1 block truncate text-[10px] font-semibold">
                        {combo.name ?? "着たコーデ"}
                      </span>
                      <span className={`block text-[9px] ${recent ? "font-bold text-danger" : "text-muted-foreground"}`}>
                        {combo.daysAgo === null
                          ? "まだ着ていない"
                          : combo.daysAgo === 0
                            ? "⚠ 今日着た"
                            : recent
                              ? `⚠ ${combo.daysAgo}日前に着た`
                              : `${combo.daysAgo}日前に着た`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-4 min-h-[54px] rounded-2xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">選んだアイテム</span>
              <button
                onClick={() => applySuggestion(slot)}
                className="flex items-center gap-1 text-[11px] font-bold text-accent"
              >
                <IconSparkles className="h-3.5 w-3.5" /> おまかせ
              </button>
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

          {/* 服を選ぶ代わりに、その場で撮った全身写真で比べる候補にもできる。
              鏡の前で2パターン着てみて撮る、という使い方向け。 */}
          <input
            ref={outfitPhotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleOutfitPhoto}
          />
          <div className="mb-4 rounded-2xl border border-dashed border-border p-3">
            {draft.outfitPhotoPreviewUrl ? (
              <div className="flex items-center gap-3">
                <span className="relative block h-24 w-[72px] shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                  <Image src={draft.outfitPhotoPreviewUrl} alt="全身写真の候補" fill className="object-cover" unoptimized />
                </span>
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                  候補{slot === 0 ? "A" : "B"}はこの全身写真で出します。服を選ばなくてもOKで、
                  選んであれば値段やタグも一緒に付きます。
                </p>
                <button
                  type="button"
                  onClick={() => updateDraft(slot, { outfitPhotoFile: null, outfitPhotoPreviewUrl: null })}
                  className="tappable shrink-0 text-[11px] font-bold text-muted-foreground"
                >
                  やめる
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => outfitPhotoInputRef.current?.click()}
                className="tappable flex w-full items-center gap-2 text-xs font-bold text-accent"
              >
                <IconCamera className="h-4 w-4 shrink-0" />
                服を選ぶ代わりに、いま撮った全身写真で比べる
              </button>
            )}
          </div>

          {buildMode === "hero" && !slotReady(slot) ? (
            <>
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                主役を1着えらぶと、残りは自動で提案します
              </p>
              {filterRows}
              <HangerRail
                items={itemsForPicker}
                selectedIds={Object.values(draft.itemIdsByCategory) as string[]}
                onSelect={(item) => applySuggestion(slot, item)}
              />
            </>
          ) : (
            <>
              <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4">
                {CLOSET_CATEGORIES.filter((c) => visibleItems.some((i) => i.category === c.value)).map((c) => (
                  <Chip key={c.value} selected={activeCategory === c.value} onClick={() => setCategoryOverride(c.value)}>
                    {c.label}
                    {draft.itemIdsByCategory[c.value] ? " ✓" : ""}
                    {buildMode === "topDown" && nextCategory === c.value ? " ←今ここ" : ""}
                  </Chip>
                ))}
              </div>

              {filterRows}

              {itemsForPicker.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {filterSeason || filterGenre || filterColor
                    ? "絞り込みに合う服がありません。チップをもう一度タップすると外せます。"
                    : "このカテゴリーの服がありません。"}
                </p>
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
          {([0, 1] as Slot[]).map((s) => {
            const sig = draftSignature(drafts[s]);
            const composed = sig ? precomposed[sig] : undefined;
            return (
              <div key={s} className="rounded-2xl border border-border bg-surface p-2">
                <p className="mb-1.5 text-center text-xs font-bold">
                  候補{s === 0 ? "A" : "B"}
                  {drafts[s].outfitPhotoPreviewUrl ? "(写真)" : ""}
                </p>
                {drafts[s].outfitPhotoPreviewUrl ? (
                  <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface-muted">
                    <Image
                      src={drafts[s].outfitPhotoPreviewUrl as string}
                      alt="全身写真の候補"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {selectedItems(s)
                      .slice(0, 4)
                      .map((item) => (
                        <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface-muted">
                          <Image src={item.imageUrl} alt={item.label} fill className="object-cover" unoptimized />
                        </div>
                      ))}
                  </div>
                )}
                {/* 顔を選ぶと、入力の裏でAI合成を先に進めておく(投稿時の待ちを無くすため)。 */}
                {sig && (
                  <p
                    className={`mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold ${
                      composed ? "text-accent" : "text-muted-foreground"
                    }`}
                  >
                    <IconSparkles className={`h-3 w-3 ${composed ? "" : "animate-pulse"}`} />
                    {composed ? "AI合成できました" : "AI合成を先に進めています…"}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-bold">今日の顔(任意)</h2>
            <span className="text-[11px] text-muted-foreground">候補{slot === 0 ? "A" : "B"}に設定</span>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            登録すると投稿カードに一緒に表示されます。
            <strong className="font-bold text-foreground">着ている姿のAI合成には、この顔写真が必要です。</strong>
            選ばない場合は、服を並べた表示のまま投稿されます。
          </p>

          {!hasAiKey && (
            <Link
              href="/profile/edit"
              className="tappable mb-3 flex items-center gap-2 rounded-2xl border border-border bg-surface p-3"
            >
              <IconSparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                <strong className="font-bold text-foreground">着ている姿をAIで作る</strong>には、
                プロフィール編集画面でご自身のAPIキー(Google AI Studio か OpenAI)を登録してください。
                登録しなくても、このまま服を並べた表示で投稿できます。
              </span>
            </Link>
          )}

          {/* キーは登録済みなのに顔が無い=合成は始まらない。以前はここで何も出さず、
              「AIが動かない」ようにしか見えなかった。理由と直し方をその場で伝える。 */}
          {hasAiKey && draft.outfitPhotoFile && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-border bg-surface-muted p-3">
              <IconSparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                この候補は<strong className="font-bold text-foreground">全身写真を使うのでAI合成はしません</strong>。
                撮った写真そのものが表示されます。AIで作りたい場合は写真を外してください。
              </span>
            </div>
          )}

          {hasAiKey && !draft.outfitPhotoFile && !draft.liveCaptureFile && !draft.facePatternId && (
            <div className="mb-3 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent-soft p-3">
              <IconSparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                <strong className="font-bold text-accent">あと1歩でAI合成できます。</strong>
                APIキーは登録済みです。着ている姿を作るには顔写真が要るので、
                下から選ぶか、その場で撮ってください。
              </span>
            </div>
          )}

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

        <Field
          label="公開範囲"
          hint="「フォロワーだけ」はあなたをフォローしている人が見て投票できます。公開にすると、それ以外の人にも届きます。"
        >
          <div className="flex gap-2">
            <Chip
              selected={outfitVisibility === "friends"}
              onClick={() => setOutfitVisibility("friends")}
            >
              フォロワーだけ
            </Chip>
            <Chip
              selected={outfitVisibility === "public"}
              onClick={() => setOutfitVisibility("public")}
            >
              みんなに公開
            </Chip>
          </div>
        </Field>

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

        {/* グループ(共有相手のプリセット)。タップで適用、✕で削除。
            下の選択状態を名前を付けて保存すると、次からワンタップで呼び出せる。 */}
        {(profile?.friendGroups ?? []).length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(profile?.friendGroups ?? []).map((g) => (
              <span key={g.id} className="flex items-center gap-1">
                <Chip size="sm" selected={false} onClick={() => applyGroup(g)}>
                  👥 {g.name}({g.memberUids.filter((u) => friends.some((f) => f.uid === u)).length})
                </Chip>
                <button
                  type="button"
                  onClick={() => removeGroup(g)}
                  disabled={groupBusy}
                  aria-label={`グループ「${g.name}」を削除`}
                  className="tappable text-muted-foreground"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {friends.length === 0 ? (
          <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              まだ相互フォローの相手がいません。いなくても投稿は保存でき、あとから自分で選べます。
            </p>
            <Link href="/profile">
              <SecondaryButton>招待コードでつながる</SecondaryButton>
            </Link>
          </div>
        ) : (
          <div className="mb-3 space-y-2">
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

        {/* いま選んでいる相手をグループとして保存(2人以上友達がいるときだけ意味がある)。 */}
        {friends.length > 1 && sharedWith.size > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="この選択をグループ名で保存(例: 仲良し)"
              maxLength={20}
              className={`${inputClass} flex-1 py-2 text-xs`}
            />
            <button
              type="button"
              onClick={saveGroup}
              disabled={!groupName.trim() || groupBusy}
              className="tappable shrink-0 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-xs font-bold disabled:opacity-40"
            >
              {groupBusy ? "保存中…" : "グループ保存"}
            </button>
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

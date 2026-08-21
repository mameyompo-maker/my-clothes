"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  clearMyGeminiKey,
  getMyGeminiKey,
  maskApiKey,
  setMyGeminiKey,
  updateAvatar,
  updateUserProfile,
} from "@/lib/firestore";
import { verifyGeminiKey } from "@/lib/functions";
import { compressImage } from "@/lib/image";
import {
  BODY_TYPES,
  PERSONAL_COLORS,
  STYLE_GENRES,
  WARDROBE_LABELS,
  type BodyType,
  type PersonalColor,
  type StyleGenre,
  type Wardrobe,
} from "@/types/models";
import {
  ActionBar,
  Avatar,
  Chip,
  Field,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  TopBar,
  inputClass,
} from "@/components/ui";
import { IconCamera, IconCheck, IconChevronLeft, IconSparkles } from "@/components/icons";

export default function EditProfilePage() {
  const { user, profile, refreshProfile, refreshGeminiKey } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(profile?.name ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [height, setHeight] = useState(profile?.height ? String(profile.height) : "");
  const [bodyType, setBodyType] = useState<BodyType>(profile?.bodyType ?? "unknown");
  // 主に使う服。2択を作るとき、既定ではこちらの見本だけを出す。
  const [primaryWardrobe, setPrimaryWardrobe] = useState<Wardrobe>(profile?.primaryWardrobe ?? "women");
  const [personalColor, setPersonalColor] = useState<PersonalColor>(profile?.personalColor ?? "unknown");
  const [personalColorSub, setPersonalColorSub] = useState<PersonalColor>(profile?.personalColorSub ?? "unknown");
  const [sizeTops, setSizeTops] = useState(profile?.sizeTops ?? "");
  const [sizeBottoms, setSizeBottoms] = useState(profile?.sizeBottoms ?? "");
  const [sizeShoes, setSizeShoes] = useState(profile?.sizeShoes ?? "");
  const [favoriteGenres, setFavoriteGenres] = useState<StyleGenre[]>(profile?.favoriteGenres ?? []);
  const [reminder, setReminder] = useState<string>(
    profile?.recommendMinuteOfDay != null
      ? `${String(Math.floor(profile.recommendMinuteOfDay / 60)).padStart(2, "0")}:${String(
          profile.recommendMinuteOfDay % 60
        ).padStart(2, "0")}`
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // --- AI合成に使う自分の Google AI Studio APIキー。
  // 保存先は userSecrets/{uid}(本人だけが読めるコレクション)。
  // 画面には伏せ字しか出さず、入力欄に元の値を流し込むこともしない。
  const [savedKeyMask, setSavedKeyMask] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyGeminiKey(user.uid)
      .then((key) => {
        if (!cancelled) setSavedKeyMask(key ? maskApiKey(key) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSaveKey() {
    const entered = keyInput.trim();
    if (!user || !entered || keyBusy) return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      await setMyGeminiKey(user.uid, entered);
      setSavedKeyMask(maskApiKey(entered));
      setKeyInput("");
      await refreshGeminiKey();
      // 保存しただけでは使えるか分からないので、そのまま実際に叩いて確かめる。
      const result = await verifyGeminiKey();
      setKeyMessage({ ok: result.ok, text: result.message });
    } catch (err) {
      setKeyMessage({ ok: false, text: err instanceof Error ? err.message : "保存に失敗しました。" });
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleVerifyKey() {
    if (keyBusy) return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const result = await verifyGeminiKey();
      setKeyMessage({ ok: result.ok, text: result.message });
    } catch (err) {
      setKeyMessage({ ok: false, text: err instanceof Error ? err.message : "確認できませんでした。" });
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleClearKey() {
    if (!user || keyBusy) return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      await clearMyGeminiKey(user.uid);
      setSavedKeyMask(null);
      setKeyInput("");
      await refreshGeminiKey();
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarBusy(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      await updateAvatar(user.uid, compressed);
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の変更に失敗しました。");
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  function toggleGenre(value: StyleGenre) {
    setFavoriteGenres((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      const [h, m] = reminder ? reminder.split(":").map(Number) : [NaN, NaN];
      await updateUserProfile(user.uid, {
        name: name.trim() || "名無しさん",
        handle: handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""),
        bio: bio.trim(),
        height: height.trim() ? Number(height) : null,
        bodyType,
        personalColor,
        // メインと同じ色をサブに残さない(2つまで、の意味が崩れるため)。
        personalColorSub: personalColorSub === personalColor ? "unknown" : personalColorSub,
        sizeTops: sizeTops.trim(),
        sizeBottoms: sizeBottoms.trim(),
        sizeShoes: sizeShoes.trim(),
        favoriteGenres,
        primaryWardrobe,
        recommendMinuteOfDay: Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null,
      });
      await refreshProfile();
      router.push("/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <>
        <TopBar title="プロフィール編集" />
        <p className="mt-10 text-center text-sm text-muted-foreground">読み込み中…</p>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="プロフィール編集"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-32 pt-4">
        {/* capture を付けないのが要点。付けるとカメラが直接起動してしまい、
            端末に保存済みの写真から選べなくなる。 */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
        <div className="mb-6 flex flex-col items-center gap-3">
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarBusy}
            className="tappable relative"
            aria-label="プロフィール画像を変更"
          >
            <Avatar src={profile.avatarUrl} name={profile.name} size={92} ring />
            <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-accent text-accent-foreground">
              <IconCamera className="h-4 w-4" />
            </span>
            {avatarBusy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/75 text-[11px] font-bold">
                更新中
              </span>
            )}
          </button>
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarBusy}
            className="tappable text-xs font-bold text-accent disabled:opacity-50"
          >
            プロフィール画像を変更
          </button>
        </div>

        <Field label="名前">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>

        <Field label="ユーザーネーム" hint="半角英数字と _ が使えます。@から始まる表示になります。">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="mikan_style"
            className={inputClass}
          />
        </Field>

        <Field label="自己紹介">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="大学生 / 韓国系とカジュアルが好き"
            className={`${inputClass} resize-none`}
          />
        </Field>

        <Field
          label="主に使う服"
          hint="2択を作るときは、まずこちらの見本だけを出します。反対側もその場で表示できます。自分で登録した服はいつでも出ます。"
        >
          <div className="flex flex-wrap gap-2">
            {(["women", "men"] as Wardrobe[]).map((w) => (
              <Chip
                key={w}
                size="sm"
                selected={primaryWardrobe === w}
                onClick={() => setPrimaryWardrobe(w)}
              >
                {WARDROBE_LABELS[w]}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="身長(cm)">
          <input
            value={height}
            onChange={(e) => setHeight(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="158"
            className={inputClass}
          />
        </Field>

        <Field label="骨格タイプ" hint={BODY_TYPES.find((b) => b.value === bodyType)?.hint}>
          <div className="flex flex-wrap gap-2">
            {BODY_TYPES.map((b) => (
              <Chip key={b.value} size="sm" selected={bodyType === b.value} onClick={() => setBodyType(b.value)}>
                {b.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="パーソナルカラー(メイン)">
          <div className="flex flex-wrap gap-2">
            {PERSONAL_COLORS.map((p) => (
              <Chip
                key={p.value}
                size="sm"
                selected={personalColor === p.value}
                onClick={() => {
                  setPersonalColor(p.value);
                  // メインに選んだ色がサブに残っていたら外す。
                  if (personalColorSub === p.value) setPersonalColorSub("unknown");
                }}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field
          label="パーソナルカラー(サブ・任意)"
          hint="診断で2ndシーズンまで出た人向け。メインと合わせて2つまで選べます。"
        >
          <div className="flex flex-wrap gap-2">
            {PERSONAL_COLORS.filter((p) => p.value !== personalColor || p.value === "unknown").map((p) => (
              <Chip
                key={p.value}
                size="sm"
                selected={personalColorSub === p.value}
                onClick={() => setPersonalColorSub(p.value)}
              >
                {p.value === "unknown" ? "なし" : p.label}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="トップス">
            <input value={sizeTops} onChange={(e) => setSizeTops(e.target.value)} placeholder="M" className={inputClass} />
          </Field>
          <Field label="ボトムス">
            <input value={sizeBottoms} onChange={(e) => setSizeBottoms(e.target.value)} placeholder="S" className={inputClass} />
          </Field>
          <Field label="靴">
            <input value={sizeShoes} onChange={(e) => setSizeShoes(e.target.value)} placeholder="24.0" className={inputClass} />
          </Field>
        </div>

        <Field label="好きなジャンル" hint="おまかせ提案のときに優先されます。">
          <div className="flex flex-wrap gap-2">
            {STYLE_GENRES.map((g) => (
              <Chip
                key={g.value}
                size="sm"
                selected={favoriteGenres.includes(g.value)}
                onClick={() => toggleGenre(g.value)}
              >
                {g.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field
          label="おすすめを受け取る時間"
          hint="設定した時刻にアプリを開くと、その日のおすすめが出ます。端末への push 通知は未対応です。"
        >
          <input type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} className={inputClass} />
        </Field>

        <section className="mb-6 rounded-3xl border border-border bg-surface p-5">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <IconSparkles className="h-4 w-4 text-accent" /> AI合成(着ている姿の生成)
          </h2>
          <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
            自分の顔写真と選んだ服から「実際に着ている姿」を作る機能です。
            <strong className="font-bold">ご自身の Google AI Studio APIキー</strong>で動きます。
            キーを登録しなくてもアプリは全部使えます(その場合は服を並べた表示になります)。
            <br />
            生成にかかる費用はご自身の Google アカウントに請求されます(1枚あたり十数円程度)。
          </p>

          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 inline-block text-xs font-bold text-accent underline"
          >
            Google AI Studio でAPIキーを取得する →
          </a>

          {savedKeyMask ? (
            <div className="mb-3 rounded-2xl border border-border bg-surface-muted p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <IconCheck className="h-4 w-4 text-accent" /> 登録済み
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{savedKeyMask}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleVerifyKey}
                  disabled={keyBusy}
                  className="tappable rounded-full border border-border-strong bg-surface px-4 py-2 text-xs font-bold disabled:opacity-50"
                >
                  {keyBusy ? "確認中…" : "使えるか確認"}
                </button>
                <button
                  onClick={handleClearKey}
                  disabled={keyBusy}
                  className="tappable rounded-full px-4 py-2 text-xs font-bold text-muted-foreground disabled:opacity-50"
                >
                  削除
                </button>
              </div>
            </div>
          ) : null}

          <Field label={savedKeyMask ? "別のキーに入れ替える" : "APIキー"}>
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza..."
              className={`${inputClass} font-mono`}
            />
          </Field>

          <SecondaryButton onClick={handleSaveKey} disabled={!keyInput.trim() || keyBusy}>
            {keyBusy ? "保存しています…" : savedKeyMask ? "入れ替えて確認する" : "保存して確認する"}
          </SecondaryButton>

          {keyMessage && (
            <p
              className={`mt-3 text-[11px] leading-relaxed ${keyMessage.ok ? "text-accent" : "text-danger"}`}
            >
              {keyMessage.text}
            </p>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            キーはあなただけが読める場所に保存され、他の利用者からは見えません。
            画面にも伏せ字でしか表示しません。
          </p>
        </section>

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      </div>

      <ActionBar>
        <PrimaryButton onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存する"}
        </PrimaryButton>
      </ActionBar>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { updateUserProfile } from "@/lib/firestore";
import {
  BODY_TYPES,
  PERSONAL_COLORS,
  STYLE_GENRES,
  type BodyType,
  type PersonalColor,
  type StyleGenre,
} from "@/types/models";
import { ActionBar, Chip, Field, IconButton, PrimaryButton, TopBar, inputClass } from "@/components/ui";
import { IconChevronLeft } from "@/components/icons";

export default function EditProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(profile?.name ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [height, setHeight] = useState(profile?.height ? String(profile.height) : "");
  const [bodyType, setBodyType] = useState<BodyType>(profile?.bodyType ?? "unknown");
  const [personalColor, setPersonalColor] = useState<PersonalColor>(profile?.personalColor ?? "unknown");
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
        sizeTops: sizeTops.trim(),
        sizeBottoms: sizeBottoms.trim(),
        sizeShoes: sizeShoes.trim(),
        favoriteGenres,
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

        <Field label="パーソナルカラー">
          <div className="flex flex-wrap gap-2">
            {PERSONAL_COLORS.map((p) => (
              <Chip
                key={p.value}
                size="sm"
                selected={personalColor === p.value}
                onClick={() => setPersonalColor(p.value)}
              >
                {p.label}
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

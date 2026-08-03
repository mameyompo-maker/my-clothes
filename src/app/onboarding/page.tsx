"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addSeedClosetItems, listClosetItems, redeemInviteCode } from "@/lib/firestore";
import { seedItemsFor, WARDROBE_STYLES, type WardrobeStyle } from "@/data/seedClosetItems";

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingContent />
    </Suspense>
  );
}

type Phase =
  | { kind: "input" }
  | { kind: "working"; label: string }
  | { kind: "added"; friendName: string }
  | { kind: "failed"; message: string };

function OnboardingContent() {
  const { user, signInWithGoogle, refreshProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromLink = (searchParams.get("invite") ?? "").trim().toUpperCase();
  const [code, setCode] = useState(inviteFromLink);
  // 初期クローゼットの中身。既定はレディース(主な想定利用者に合わせている)。
  const [style, setStyle] = useState<WardrobeStyle>("women");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  // サインイン済みの人が招待リンクを開いたときの処理を、一度だけ走らせるための番人。
  const linkHandled = useRef(false);

  useEffect(() => {
    if (!user || linkHandled.current) return;
    linkHandled.current = true;
    if (!inviteFromLink) {
      router.replace("/feed");
      return;
    }
    void (async () => {
      setPhase({ kind: "working", label: "友達を追加しています…" });
      try {
        const { friendName } = await redeemInviteCode(user.uid, inviteFromLink);
        await refreshProfile();
        setPhase({ kind: "added", friendName });
      } catch (err) {
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "招待コードの処理に失敗しました。",
        });
      }
    })();
  }, [user, inviteFromLink, router, refreshProfile]);

  async function seedClosetIfEmpty(uid: string) {
    const existing = await listClosetItems(uid);
    if (existing.length === 0) {
      await addSeedClosetItems(uid, seedItemsFor(style));
    }
  }

  async function handleSignIn() {
    // ここから先はこの関数が流れを主導するので、上のuseEffectには手を出させない。
    linkHandled.current = true;
    setPhase({ kind: "working", label: "サインインしています…" });
    let signedInUid: string;
    try {
      const signedInUser = await signInWithGoogle();
      signedInUid = signedInUser.uid;
      await seedClosetIfEmpty(signedInUid);
    } catch (err) {
      linkHandled.current = false;
      setPhase({ kind: "failed", message: err instanceof Error ? err.message : "サインインに失敗しました。" });
      return;
    }

    const entered = code.trim().toUpperCase();
    if (!entered) {
      router.replace("/feed");
      return;
    }
    setPhase({ kind: "working", label: "友達を追加しています…" });
    try {
      const { friendName } = await redeemInviteCode(signedInUid, entered);
      await refreshProfile();
      setPhase({ kind: "added", friendName });
    } catch (err) {
      setPhase({
        kind: "failed",
        message: err instanceof Error ? err.message : "招待コードの処理に失敗しました。",
      });
    }
  }

  const showSpinner = phase.kind === "working" || (phase.kind === "input" && user !== null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-8 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">My Clothes</h1>
        <p className="text-sm text-muted-foreground">朝のコーデ選びを、友達と一緒に。</p>
      </div>

      {showSpinner && (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {phase.kind === "working" ? phase.label : "読み込み中…"}
          </p>
        </div>
      )}

      {phase.kind === "added" && (
        <div className="w-full max-w-xs space-y-4">
          <div className="space-y-1">
            <p className="text-base font-semibold">{phase.friendName}さんと友達になりました!</p>
            <p className="text-xs text-muted-foreground">
              お互いのコーデ投稿に投票できるようになりました。
            </p>
          </div>
          <button
            onClick={() => router.replace("/feed")}
            className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30"
          >
            はじめる
          </button>
        </div>
      )}

      {!user && (phase.kind === "input" || phase.kind === "failed") && (
        <div className="w-full max-w-xs space-y-4">
          {/* 空のクローゼットから始めさせると何もできないので、最初から実物の服を入れておく。
              メンズとレディースで中身がまるで違うため、どちらを入れるかは本人に選ばせる。 */}
          <div className="text-left">
            <p className="mb-1.5 block text-xs font-medium text-muted-foreground">最初のクローゼット</p>
            <div className="space-y-2">
              {WARDROBE_STYLES.map((option) => {
                const selected = style === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStyle(option.value)}
                    aria-pressed={selected}
                    className={`tappable w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      selected ? "border-accent bg-accent-soft" : "border-border bg-surface"
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
            <p className="mt-1 text-xs text-muted-foreground">あとから自分の服を追加・削除できます。</p>
          </div>

          <div className="text-left">
            <label htmlFor="invite-code" className="mb-1 block text-xs font-medium text-muted-foreground">
              招待コード(あれば)
            </label>
            <input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="例: AB12CD"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-lg tracking-widest uppercase outline-none focus:border-accent"
              maxLength={6}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              後からプロフィール画面でも追加できます。
            </p>
          </div>
          <button
            onClick={handleSignIn}
            className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30"
          >
            Googleでサインイン
          </button>
          {phase.kind === "failed" && <p className="text-sm text-red-500">{phase.message}</p>}
        </div>
      )}

      {user && phase.kind === "failed" && (
        <div className="w-full max-w-xs space-y-4">
          <p className="text-sm text-red-500">{phase.message}</p>
          <p className="text-xs text-muted-foreground">
            プロフィール画面の「友達の招待コードを入力して追加」から、もう一度試せます。
          </p>
          <button
            onClick={() => router.replace("/feed")}
            className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30"
          >
            アプリを開く
          </button>
        </div>
      )}
    </div>
  );
}

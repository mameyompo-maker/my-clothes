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
    <div className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        {/* 表紙。参照デザインの「写真の上に巨大な見出し」を、色面で置き換えている。 */}
        <div className="mb-8">
          <p className="overline mb-2">Morning outfit, decided</p>
          <h1 className="display text-[3.25rem] text-foreground">
            My
            <br />
            <span className="bg-accent px-1.5">Clothes</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            朝のコーデ選びを、友達と一緒に。
          </p>
        </div>

        {showSpinner && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-foreground border-t-transparent" />
            <p className="overline">{phase.kind === "working" ? phase.label : "読み込み中…"}</p>
          </div>
        )}

        {phase.kind === "added" && (
          <div className="space-y-5">
            <div className="border-[1.5px] border-border-strong bg-accent p-4">
              <p className="display-ja text-base text-accent-foreground">
                {phase.friendName}さんと友達になりました
              </p>
              <p className="mt-1 text-xs leading-relaxed text-accent-foreground/70">
                お互いのコーデ投稿に投票できるようになりました。
              </p>
            </div>
            <button
              onClick={() => router.replace("/feed")}
              className="tappable hard-edge display-ja w-full bg-foreground px-6 py-3.5 text-sm text-background"
            >
              はじめる
            </button>
          </div>
        )}

        {!user && (phase.kind === "input" || phase.kind === "failed") && (
          <div className="space-y-7">
            {/* 初期クローゼット。空のクローゼットから始めさせると何もできないので、
                最初から実物の服を入れておく。どちらを入れるかは本人に選ばせる。 */}
            <section>
              <div className="mb-2.5 flex items-baseline gap-2 border-b border-border pb-1.5">
                <span className="index-tag">001</span>
                <h2 className="display-ja text-sm">最初のクローゼット</h2>
              </div>
              <div className="space-y-2">
                {WARDROBE_STYLES.map((option) => {
                  const selected = style === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStyle(option.value)}
                      aria-pressed={selected}
                      className={`tappable flex w-full items-center justify-between gap-3 border-[1.5px] px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-border-strong bg-accent"
                          : "border-border bg-surface"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="display-ja block text-sm">{option.label}</span>
                        <span
                          className={`mt-0.5 block text-[11px] leading-snug ${
                            selected ? "text-accent-foreground/70" : "text-muted-foreground"
                          }`}
                        >
                          {option.caption}
                        </span>
                      </span>
                      <span
                        className={`h-3.5 w-3.5 shrink-0 border-[1.5px] border-foreground ${
                          selected ? "bg-foreground" : "bg-transparent"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                あとから自分の服を追加・削除できます。
              </p>
            </section>

            <section>
              <div className="mb-2.5 flex items-baseline gap-2 border-b border-border pb-1.5">
                <span className="index-tag">002</span>
                <h2 className="display-ja text-sm">招待コード(あれば)</h2>
              </div>
              <input
                id="invite-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="AB12CD"
                className="w-full border-[1.5px] border-border-strong bg-surface px-4 py-3 text-center text-lg font-bold uppercase tracking-[0.3em] outline-none focus:border-foreground focus:bg-accent-soft"
                maxLength={6}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                後からマイページでも追加できます。
              </p>
            </section>

            <div className="space-y-3">
              <button
                onClick={handleSignIn}
                className="tappable hard-edge display-ja w-full bg-accent px-6 py-4 text-sm text-accent-foreground"
              >
                Googleではじめる
              </button>
              {phase.kind === "failed" && (
                <p className="text-sm font-semibold text-danger">{phase.message}</p>
              )}
            </div>
          </div>
        )}

        {user && phase.kind === "failed" && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-danger">{phase.message}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              マイページの「友達の招待コードを入力して追加」から、もう一度試せます。
            </p>
            <button
              onClick={() => router.replace("/feed")}
              className="tappable hard-edge display-ja w-full bg-accent px-6 py-3.5 text-sm text-accent-foreground"
            >
              アプリを開く
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

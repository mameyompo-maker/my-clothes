"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  addSeedClosetItems,
  listClosetItems,
  redeemInviteCode,
  setMyAiKey,
  updateUserProfile,
} from "@/lib/firestore";
import { verifyAiKey } from "@/lib/functions";
import { seedItemsFor, WARDROBE_STYLES, type WardrobeStyle } from "@/data/seedClosetItems";
import {
  ApiKeyField,
  ApiKeyHeading,
  ApiKeyHelp,
  ApiKeyIntro,
  NoKeyNotice,
} from "@/components/ApiKeySetup";

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingContent />
    </Suspense>
  );
}

/**
 * AI合成が使える状態になったかどうか。登録し終えた画面で本人に伝える。
 * null は「その話をしない」(招待リンクから来た既存ユーザーなど)。
 */
type AiOutcome = { kind: "none" } | { kind: "ok"; text: string } | { kind: "ng"; text: string };

type Phase =
  | { kind: "input" }
  | { kind: "working"; label: string }
  | { kind: "done"; friendName: string | null; ai: AiOutcome | null }
  | { kind: "failed"; message: string };

function OnboardingContent() {
  const { user, signInWithGoogle, refreshProfile, refreshAiKey } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromLink = (searchParams.get("invite") ?? "").trim().toUpperCase();
  const [code, setCode] = useState(inviteFromLink);
  // 初期クローゼットの中身。既定はレディース(主な想定利用者に合わせている)。
  const [style, setStyle] = useState<WardrobeStyle>("women");
  // AI合成に使うAPIキー。**任意**。空のまま登録してもアプリは全部使える。
  const [apiKey, setApiKey] = useState("");
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
      setPhase({ kind: "working", label: "招待コードを確認しています…" });
      try {
        const { friendName } = await redeemInviteCode(user.uid, inviteFromLink);
        await refreshProfile();
        // 既にアカウントがある人なので、APIキーの話はここでは持ち出さない。
        setPhase({ kind: "done", friendName, ai: null });
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
      // 「主に使う服」の初期値。両方を入れた人は、ひとまずウィメンズを主にしておく
      // (あとから設定画面で変えられる)。
      await updateUserProfile(uid, { primaryWardrobe: style === "men" ? "men" : "women" });
    }
  }

  /**
   * 入力されたキーを保存して、そのまま使えるか確かめる。
   *
   * ここで失敗しても**登録そのものは止めない**。キーは任意で、あとから設定画面で
   * いくらでも直せるため。結果は最後の画面で伝えるだけにとどめる。
   */
  async function saveApiKeyIfEntered(uid: string): Promise<AiOutcome> {
    const entered = apiKey.trim();
    if (!entered) return { kind: "none" };
    try {
      const provider = await setMyAiKey(uid, entered);
      if (!provider) {
        return {
          kind: "ng",
          text: "キーの形式が違うようです。AIza(Google)または sk-(OpenAI)で始まる文字列か確認してください。プロフィールの編集画面から入れ直せます。",
        };
      }
      await refreshAiKey();
      const result = await verifyAiKey();
      return result.ok ? { kind: "ok", text: result.message } : { kind: "ng", text: result.message };
    } catch (err) {
      return {
        kind: "ng",
        text: err instanceof Error ? err.message : "APIキーを確認できませんでした。",
      };
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

    let ai: AiOutcome = { kind: "none" };
    if (apiKey.trim()) {
      setPhase({ kind: "working", label: "APIキーを確認しています…" });
      ai = await saveApiKeyIfEntered(signedInUid);
    }

    const entered = code.trim().toUpperCase();
    if (!entered) {
      setPhase({ kind: "done", friendName: null, ai });
      return;
    }
    setPhase({ kind: "working", label: "友達を追加しています…" });
    try {
      const { friendName } = await redeemInviteCode(signedInUid, entered);
      await refreshProfile();
      setPhase({ kind: "done", friendName, ai });
    } catch (err) {
      setPhase({
        kind: "failed",
        message: err instanceof Error ? err.message : "招待コードの処理に失敗しました。",
      });
    }
  }

  const showSpinner = phase.kind === "working" || (phase.kind === "input" && user !== null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-7 px-6 py-10 text-center">
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

      {phase.kind === "done" && (
        <div className="w-full space-y-4">
          <div className="space-y-1">
            <p className="text-base font-semibold">
              {phase.friendName ? phase.friendName + "さんとつながりました!" : "準備ができました!"}
            </p>
            <p className="text-xs text-muted-foreground">
              {phase.friendName
                ? "お互いのコーデ投稿に投票できるようになりました。"
                : "クローゼットに服を入れておいたので、そのまま2択を作れます。"}
            </p>
          </div>

          {phase.ai?.kind === "ok" && (
            <div className="rounded-2xl border border-accent/40 bg-accent-soft p-3 text-left">
              <p className="text-xs font-bold text-accent">AI合成が使えます</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{phase.ai.text}</p>
            </div>
          )}

          {phase.ai?.kind === "ng" && (
            <div className="rounded-2xl border border-danger/40 bg-danger/5 p-3 text-left">
              <p className="text-xs font-bold text-danger">APIキーを確認できませんでした</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{phase.ai.text}</p>
            </div>
          )}

          {phase.ai?.kind === "none" && <NoKeyNotice where="onboarding" />}

          <button
            onClick={() => router.replace("/feed")}
            className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30"
          >
            はじめる
          </button>
        </div>
      )}

      {!user && (phase.kind === "input" || phase.kind === "failed") && (
        <div className="w-full space-y-5">
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

          {/* APIキーは**任意**。ここで入れておくと、最初の2択からAI合成が使える。
              入れなくても登録できることが分かるように、未入力のときは NoKeyNotice を出す。 */}
          <div className="space-y-3 text-left">
            <div>
              <ApiKeyHeading>AI合成のAPIキー(任意)</ApiKeyHeading>
              <div className="mt-1.5">
                <ApiKeyIntro />
              </div>
            </div>

            <ApiKeyField value={apiKey} onChange={setApiKey} />
            <ApiKeyHelp />
            {!apiKey.trim() && <NoKeyNotice where="onboarding" />}
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
        <div className="w-full space-y-4">
          <p className="text-sm text-red-500">{phase.message}</p>
          <p className="text-xs text-muted-foreground">
            プロフィール画面の「招待コードを入力してつながる」から、もう一度試せます。
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

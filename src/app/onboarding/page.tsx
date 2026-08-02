"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { addSeedClosetItems, listClosetItems, redeemInviteCode } from "@/lib/firestore";
import { SEED_CLOSET_ITEMS } from "@/data/seedClosetItems";

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const { user, signInWithGoogle } = useAuth();
  const searchParams = useSearchParams();
  const prefillCode = searchParams.get("invite") ?? "";
  const [code, setCode] = useState(prefillCode);
  const [status, setStatus] = useState<"idle" | "signing-in" | "redeeming" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSignIn() {
    setStatus("signing-in");
    setErrorMessage("");
    try {
      const signedInUser = await signInWithGoogle();
      await seedClosetIfEmpty(signedInUser.uid);
      if (code.trim()) {
        await tryRedeem(signedInUser.uid, code.trim());
      } else {
        setStatus("done");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "サインインに失敗しました。");
    }
  }

  async function seedClosetIfEmpty(uid: string) {
    const existing = await listClosetItems(uid);
    if (existing.length === 0) {
      await addSeedClosetItems(uid, SEED_CLOSET_ITEMS);
    }
  }

  async function tryRedeem(uid: string, inviteCode: string) {
    setStatus("redeeming");
    try {
      await redeemInviteCode(uid, inviteCode);
      setStatus("done");
    } catch (err) {
      // 友達追加に失敗してもオンボーディング自体は続行する。
      setStatus("done");
      setErrorMessage(err instanceof Error ? err.message : "招待コードの処理に失敗しました。");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-8 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">My Clothes</h1>
        <p className="text-sm text-muted-foreground">朝のコーデ選びを、友達と一緒に。</p>
      </div>

      {!user ? (
        <div className="w-full max-w-xs space-y-4">
          <div className="text-left">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              招待コード(あれば)
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="例: AB12CD"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-lg tracking-widest uppercase outline-none focus:border-accent"
              maxLength={6}
            />
          </div>
          <button
            onClick={handleSignIn}
            disabled={status === "signing-in"}
            className="w-full rounded-full bg-accent px-6 py-3 font-semibold text-accent-foreground shadow-lg shadow-accent/30 disabled:opacity-60"
          >
            {status === "signing-in" ? "サインイン中…" : "Googleでサインイン"}
          </button>
          {status === "error" && <p className="text-sm text-red-500">{errorMessage}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "redeeming" ? "友達を追加しています…" : "準備中です…"}
        </p>
      )}
    </div>
  );
}

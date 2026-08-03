"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createBillingPortalSession, createCheckoutSession } from "@/lib/functions";
import { isPremium } from "@/types/models";
import { IconButton, PrimaryButton, SecondaryButton, TopBar } from "@/components/ui";
import { IconCheck, IconChevronLeft, IconSparkles } from "@/components/icons";

/**
 * 有料プランの説明と申し込み。
 *
 * 方針として、しつこい課金導線は置かない。ここへ来るのはロックされた機能を
 * 触ったときだけで、閉じたら元の画面に戻るだけ。常時表示のバナーや再訪の催促、
 * 期間限定を煽る表示はしない。解約導線も同じ画面に並べて隠さない。
 */
export default function UpgradePage() {
  return (
    <Suspense fallback={null}>
      <UpgradeContent />
    </Suspense>
  );
}

/**
 * Stripe の設定(シークレットと price ID、Webhook)が済むまでは false のままにしておく。
 * true にしないと申し込みボタンを出さないので、押しても失敗するだけの導線を
 * ユーザーに見せずに済む。Vercel の環境変数で切り替える。
 */
const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

function UpgradeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, refreshProfile } = useAuth();
  const premium = isPremium(profile);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = searchParams.get("result");

  // 決済から戻った直後は、Webhook が plan を書き終えるまで数秒かかることがある。
  // 一度だけ読み直して、間に合わなければ案内を出す。
  useEffect(() => {
    if (result !== "success") return;
    const timer = setTimeout(() => {
      void refreshProfile();
    }, 2500);
    return () => clearTimeout(timer);
  }, [result, refreshProfile]);

  async function startCheckout() {
    setBusy(true);
    setError("");
    try {
      window.location.href = await createCheckoutSession();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "決済ページを開けませんでした。時間をおいてお試しください。"
      );
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      window.location.href = await createBillingPortalSession();
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : "お手続きの画面を開けませんでした。"
      );
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar
        title="プランについて"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-6">
        {result === "success" && !premium && (
          <div className="mb-5 rounded-none border border-border bg-surface p-4">
            <p className="text-sm font-bold">お手続きを確認しています</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              反映まで少し時間がかかることがあります。しばらくしてもこの表示のままなら、
              一度アプリを開き直してください。
            </p>
          </div>
        )}

        {premium ? (
          <>
            <div className="mb-6 rounded-none border border-border-strong bg-accent-soft p-6 text-center">
              <IconSparkles className="mx-auto mb-2 h-8 w-8 text-foreground" />
              <p className="text-base font-bold text-foreground">プレミアムをご利用中です</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                おまかせ提案がいつでも使えます。ありがとうございます。
              </p>
            </div>
            <SecondaryButton onClick={openPortal} disabled={busy}>
              {busy ? "開いています…" : "お支払い情報の確認・解約"}
            </SecondaryButton>
          </>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="mb-2 text-xl font-bold tracking-tight">おまかせ提案はプレミアム機能です</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                手持ちの服から自動でコーデを組む機能は、プレミアムでご利用いただけます。
                それ以外の機能は今までどおり無料で使えます。
              </p>
            </div>

            <section className="mb-5 rounded-none border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-bold">プレミアムでできること</h2>
              <ul className="space-y-2.5">
                <Benefit>おまかせで2択を自動生成する</Benefit>
                <Benefit>主役の1着から残りを自動で組む</Benefit>
                <Benefit>季節・好みのジャンル・着ていない期間をふまえた提案</Benefit>
              </ul>
            </section>

            <section className="mb-6 rounded-none border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-bold">無料のままできること</h2>
              <ul className="space-y-2.5">
                <Benefit>2択を作って友達に選んでもらう(1日1回)</Benefit>
                <Benefit>AIによる着用イメージの生成</Benefit>
                <Benefit>クローゼットの登録・タグ付け・絞り込み</Benefit>
                <Benefit>全身写真の投稿、いいね、コメント、フォロー、DM</Benefit>
                <Benefit>1ヶ月のコーデ記録</Benefit>
              </ul>
            </section>

            {BILLING_ENABLED ? (
              <>
                <PrimaryButton onClick={startCheckout} disabled={busy}>
                  {busy ? "決済ページを開いています…" : "プレミアムに申し込む"}
                </PrimaryButton>
                <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
                  お支払いは Stripe の安全なページで行います。カード情報がこのアプリに保存されることはありません。
                  いつでも解約でき、解約後も無料の機能はそのままお使いいただけます。
                </p>
              </>
            ) : (
              <div className="rounded-none border border-dashed border-border p-5 text-center">
                <p className="mb-1 text-sm font-bold">現在お申し込みは受け付けていません</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  決済のしくみを準備中です。用意ができたらこの画面からお申し込みいただけるようになります。
                </p>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="mt-4 rounded-none border border-danger/40 bg-danger/5 p-3 text-xs leading-relaxed text-danger">
            {error}
          </p>
        )}

        <div className="mt-8 flex justify-center gap-4 text-[11px] text-muted-foreground">
          <Link href="/legal/tokushoho" className="underline">
            特定商取引法に基づく表記
          </Link>
        </div>

        <div className="mt-6">
          <Link href="/create">
            <SecondaryButton>手動でコーデを作る</SecondaryButton>
          </Link>
        </div>
      </div>
    </>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed">
      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <span>{children}</span>
    </li>
  );
}

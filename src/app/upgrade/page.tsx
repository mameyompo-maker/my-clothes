"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isPremium } from "@/types/models";
import { IconButton, SecondaryButton, TopBar } from "@/components/ui";
import { IconCheck, IconChevronLeft, IconSparkles } from "@/components/icons";

/**
 * 有料プランの説明。
 *
 * 方針として、しつこい課金導線は置かない。ここへ来るのは有料機能を触ったときの
 * 1回だけで、閉じたら元の画面に戻るだけ。バナーの常時表示や再訪の催促はしない。
 */
export default function UpgradePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const premium = isPremium(profile);

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
        {premium ? (
          <div className="rounded-3xl border border-accent/40 bg-accent-soft p-6 text-center">
            <IconSparkles className="mx-auto mb-2 h-8 w-8 text-accent" />
            <p className="text-base font-bold text-accent">プレミアムをご利用中です</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              おまかせ提案がいつでも使えます。ありがとうございます。
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="mb-2 text-xl font-bold tracking-tight">おまかせ提案はプレミアム機能です</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                手持ちの服から自動でコーデを組む機能は、プレミアムでご利用いただけます。
                それ以外の機能は今までどおり無料で使えます。
              </p>
            </div>

            <section className="mb-6 rounded-3xl border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-bold">プレミアムでできること</h2>
              <ul className="space-y-2.5">
                <Benefit>おまかせで2択を自動生成する</Benefit>
                <Benefit>主役の1着から残りを自動で組む</Benefit>
                <Benefit>季節・好みのジャンル・着ていない期間をふまえた提案</Benefit>
              </ul>
            </section>

            <section className="mb-6 rounded-3xl border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-bold">無料のままできること</h2>
              <ul className="space-y-2.5">
                <Benefit>2択を作って友達に選んでもらう(1日1回)</Benefit>
                <Benefit>AIによる着用イメージの生成</Benefit>
                <Benefit>クローゼットの登録・タグ付け・絞り込み</Benefit>
                <Benefit>全身写真の投稿、いいね、コメント、フォロー、DM</Benefit>
                <Benefit>1ヶ月のコーデ記録</Benefit>
              </ul>
            </section>

            <div className="rounded-3xl border border-dashed border-border p-5 text-center">
              <p className="mb-1 text-sm font-bold">現在お申し込みは受け付けていません</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                決済のしくみを準備中です。用意ができたらこの画面からお申し込みいただけるようになります。
              </p>
            </div>
          </>
        )}

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
      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

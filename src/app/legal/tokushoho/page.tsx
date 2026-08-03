"use client";

import { useRouter } from "next/navigation";
import { IconButton, TopBar } from "@/components/ui";
import { IconChevronLeft } from "@/components/icons";

/**
 * 特定商取引法に基づく表記。
 *
 * 日本で有料サービスを販売する場合、この表示は任意ではなく法令上の義務。
 * 事業者の実在情報は本人しか書けないため、ここでは未記入であることを明示した
 * 雛形にしてある。埋めないまま課金を受け付けると法令違反になるので、
 * 有料プランを公開する前に必ず実際の情報へ差し替えること。
 */

const ROWS: { label: string; value: string | null; note?: string }[] = [
  { label: "販売事業者", value: "河村和仁" },
  { label: "運営責任者", value: "河村和仁" },
  { label: "所在地", value: "東京都府中市幸町2-9-5 グランディオ府中202号室" },
  {
    label: "連絡先",
    value: "mameyompo@gmail.com(電話番号はご請求があれば遅滞なく開示いたします)",
  },
  { label: "販売価格", value: "月額330円(税込)" },
  { label: "商品代金以外の必要料金", value: "通信料はお客様のご負担となります。" },
  { label: "支払方法", value: "クレジットカード(Stripe による決済)" },
  { label: "支払時期", value: "お申し込み時に初回課金、以降は毎月同日に自動更新" },
  { label: "サービス提供時期", value: "決済完了後、ただちにご利用いただけます。" },
  {
    label: "返品・解約について",
    value:
      "デジタルサービスの性質上、提供開始後の返金はお受けできません。解約はアプリ内のプラン画面からいつでも行え、次回更新日以降の請求は発生しません。",
  },
  { label: "動作環境", value: "最新版の Chrome / Safari / Edge" },
];

export default function TokushohoPage() {
  const router = useRouter();
  const unfilled = ROWS.filter((r) => r.value === null).length;

  return (
    <>
      <TopBar
        title="特定商取引法に基づく表記"
        left={
          <IconButton label="戻る" onClick={() => router.back()}>
            <IconChevronLeft className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="mx-auto max-w-lg px-4 pb-28 pt-5">
        {unfilled > 0 && (
          <div className="mb-5 rounded-2xl border border-danger/40 bg-danger/5 p-4">
            <p className="text-sm font-bold text-danger">この表記はまだ完成していません</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {unfilled}項目が未記入です。日本で有料サービスを販売するにはこの表示が法令上必要なので、
              有料プランの受付を始める前に
              <code className="mx-1 rounded bg-surface-muted px-1">src/app/legal/tokushoho/page.tsx</code>
              の ROWS を実際の情報に差し替えてください。
            </p>
          </div>
        )}

        <dl className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
          {ROWS.map((row) => (
            <div key={row.label} className="px-4 py-3.5">
              <dt className="mb-1 text-xs font-bold text-muted-foreground">{row.label}</dt>
              <dd className="text-sm leading-relaxed">
                {row.value ?? <span className="font-bold text-danger">(未記入)</span>}
                {row.note && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">記入の目安: {row.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

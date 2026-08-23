"use client";

import { useState } from "react";
import { AI_PROVIDERS, detectAiProvider, providerInfo, type AiProvider } from "@/lib/aiProviders";
import { inputClass } from "./ui";
import { IconCheck, IconSparkles } from "./icons";

/**
 * APIキーまわりの共通パーツ。
 *
 * オンボーディング(最初の登録画面)とプロフィール編集の**両方**で同じ説明・同じ
 * 取得手順を出すために切り出してある。片方だけ文言を直すと、登録時と設定時で
 * 説明が食い違って利用者が混乱するので、必ずここを直すこと。
 */

/** AI合成が何なのか、キーが要る理由。登録画面でも設定画面でも同じ説明を出す。 */
export function ApiKeyIntro() {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      自分の顔写真と選んだ服から「実際に着ている姿」を作る機能です。
      <strong className="font-bold">ご自身のAPIキー</strong>で動きます。
      Google AI Studio と OpenAI のどちらのキーでも使えます。
      生成にかかる費用はご自身のアカウントに請求されます。
    </p>
  );
}

/**
 * キーを入れずに進もうとしている人への注意書き。
 * 責めるためではなく「今どうなるか」と「あとで直せる」ことを伝えるのが目的。
 */
export function NoKeyNotice({ where }: { where: "onboarding" | "settings" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-3 text-left">
      <p className="text-xs font-bold">このままだとAI生成は使えません</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        APIキーを登録していないと、「着ている姿」の自動生成だけが使えません。
        {where === "onboarding"
          ? "それ以外の機能——クローゼット、2択の投稿と投票、コーデ記録、DM——は今のまま全部使えます。"
          : "それ以外の機能は今のまま全部使えます。"}
        <br />
        キーは
        {where === "onboarding" ? "登録したあとでも" : "いつでも"}
        プロフィールの編集画面から追加できます。
      </p>
    </div>
  );
}

/** キーの入力欄。貼られた文字列からサービスを判別して、その場で1行返す。 */
export function ApiKeyField({
  value,
  onChange,
  placeholder = "AIza... または sk-...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const trimmed = value.trim();
  const provider = detectAiProvider(trimmed);

  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className={`${inputClass} font-mono`}
      />
      {trimmed.length > 0 && (
        <p
          className={`mt-1.5 text-[11px] leading-relaxed ${
            provider ? "text-accent" : "text-muted-foreground"
          }`}
        >
          {provider
            ? `${providerInfo(provider).label} のキーとして登録します。`
            : "見覚えのない形式です。「AIza」または「sk-」で始まる文字列を貼り付けてください。"}
        </p>
      )}
    </div>
  );
}

/**
 * 取得手順。サービスを切り替えられるようにしてある。
 *
 * 既定で開いてはいない。登録画面で最初から全手順が展開されていると、
 * 「これを全部やらないと始められない」と受け取られてしまうため。
 */
export function ApiKeyHelp({ defaultProvider = "google" }: { defaultProvider?: AiProvider }) {
  const [selected, setSelected] = useState<AiProvider>(defaultProvider);
  const info = providerInfo(selected);

  return (
    <details className="rounded-2xl border border-border bg-surface-muted p-3 text-left">
      <summary className="cursor-pointer list-none text-xs font-bold text-accent">
        APIキーの取り方を見る
      </summary>

      <div className="mt-3">
        <div className="mb-3 flex gap-1.5">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setSelected(p.value)}
              aria-pressed={selected === p.value}
              className={`tappable rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                selected === p.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <a
          href={info.consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 inline-block text-[11px] font-bold text-accent underline"
        >
          {info.label} でAPIキーを取得する →
        </a>

        <ol className="space-y-2">
          {info.steps.map((step, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-3 rounded-xl bg-surface p-2.5 text-[10px] leading-relaxed text-muted-foreground">
          <strong className="font-bold">費用について:</strong> {info.cost}
        </p>
      </div>
    </details>
  );
}

/** 登録済みのキーを伏せ字で見せる箱。設定画面と登録完了画面で使う。 */
export function SavedKeyBadge({ mask, providerLabel }: { mask: string; providerLabel?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-3 text-left">
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <IconCheck className="h-4 w-4 text-accent" />
        登録済み{providerLabel ? `(${providerLabel})` : ""}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{mask}</p>
    </div>
  );
}

/** 見出し。AI合成の欄だとひと目で分かるように。 */
export function ApiKeyHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-bold">
      <IconSparkles className="h-4 w-4 text-accent" /> {children}
    </h2>
  );
}

"use client";

import Image from "next/image";
import type { ReactNode } from "react";

/** 頭文字だけのフォールバック付きアバター。avatarUrl は Google 由来で欠けることがある。 */
export function Avatar({
  src,
  name,
  size = 40,
  ring = false,
}: {
  src?: string | null;
  name: string;
  size?: number;
  /** ストーリー風のグラデーションリング。新着や強調に使う。 */
  ring?: boolean;
}) {
  const inner = src ? (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      className="h-full w-full rounded-full object-cover"
      unoptimized
    />
  ) : (
    <div
      className="flex h-full w-full items-center justify-center rounded-full bg-surface-strong font-semibold text-muted-foreground"
      style={{ fontSize: size * 0.4 }}
    >
      {name.trim().charAt(0) || "?"}
    </div>
  );

  if (!ring) {
    return (
      <div className="shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
        {inner}
      </div>
    );
  }

  return (
    <div className="gradient-ring shrink-0 rounded-full p-[2px]" style={{ width: size + 5, height: size + 5 }}>
      <div className="h-full w-full rounded-full bg-background p-[2px]">
        <div className="h-full w-full overflow-hidden rounded-full">{inner}</div>
      </div>
    </div>
  );
}

export function Chip({
  children,
  selected = false,
  onClick,
  size = "md",
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs";
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      type={onClick ? "button" : undefined}
      className={`tappable shrink-0 rounded-full border font-medium transition-colors ${pad} ${
        selected
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-surface text-muted-foreground"
      }`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="text-muted-foreground opacity-60">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

/** 画面上部の固定ヘッダー。Instagram のように薄く曇らせて写真の上に重ねる。 */
export function TopBar({
  title,
  left,
  right,
}: {
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
        {title && <div className="flex-1 truncate text-center text-base font-bold tracking-tight">{title}</div>}
        <div className="flex flex-1 items-center justify-end gap-1">{right}</div>
      </div>
    </header>
  );
}

export function IconButton({
  onClick,
  label,
  children,
  disabled,
}: {
  onClick?: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className="tappable flex h-10 w-10 items-center justify-center rounded-full text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  full = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  full?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`tappable rounded-full bg-accent px-6 py-3.5 text-sm font-bold text-accent-foreground shadow-[var(--shadow-float)] disabled:opacity-40 disabled:shadow-none ${
        full ? "w-full" : ""
      }`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  full = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tappable rounded-full border border-border-strong bg-surface px-6 py-3 text-sm font-semibold disabled:opacity-40 ${
        full ? "w-full" : ""
      }`}
    >
      {children}
    </button>
  );
}

/** 下からせり出すシート。編集フォームや詳細に使う。 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div className="animate-fade-up relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="tappable text-sm font-semibold text-muted-foreground">
            閉じる
          </button>
        </div>
        <div className="px-5 pt-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors focus:border-accent";

/** 相対時刻。フィードで「3分前」のように出す。 */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  const date = new Date(ms);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCloset, IconFeed, IconPlus, IconProfile } from "./icons";

const TABS = [
  { href: "/feed", label: "フィード", icon: IconFeed },
  { href: "/closet", label: "クローゼット", icon: IconCloset },
  { href: "/create", label: "投稿", icon: IconPlus },
  { href: "/profile", label: "プロフィール", icon: IconProfile },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const isCreate = href === "/create";
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-1.5 text-xs transition-colors ${
                  isCreate
                    ? "bg-accent text-accent-foreground -mt-6 h-14 w-14 justify-center shadow-lg shadow-accent/30"
                    : active
                      ? "text-accent"
                      : "text-muted-foreground"
                }`}
              >
                <Icon className={isCreate ? "h-6 w-6" : "h-5 w-5"} />
                {!isCreate && <span>{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

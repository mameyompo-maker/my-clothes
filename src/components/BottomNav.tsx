"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCloset, IconHome, IconPlus, IconProfile, IconVote } from "./icons";

const TABS = [
  { href: "/feed", label: "ホーム", icon: IconHome },
  { href: "/vote", label: "2択", icon: IconVote },
  { href: "/create", label: "作る", icon: IconPlus },
  { href: "/closet", label: "クローゼット", icon: IconCloset },
  { href: "/profile", label: "マイページ", icon: IconProfile },
];

/**
 * 下タブ。
 *
 * 現在地はネオンの「面」で示し、文字や線をネオンにはしない。
 * ネオン(#EBFC34)は地色のライトグレー(#D9D9D9)とほぼ同じ明るさで、
 * 文字色に使うと読めなくなるため。ネオンは必ず黒を乗せる下地として使うこと。
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t-[1.5px] border-border-strong bg-background/95 backdrop-blur-xl">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const isCreate = href === "/create";

          if (isCreate) {
            return (
              <li key={href} className="flex items-center">
                <Link
                  href={href}
                  aria-label="コーデを作る"
                  className="tappable hard-edge flex h-11 w-14 items-center justify-center bg-accent text-accent-foreground"
                >
                  <Icon className="h-6 w-6" strokeWidth={2.4} />
                </Link>
              </li>
            );
          }

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`tappable flex flex-col items-center gap-1 py-1.5 ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className={`px-2.5 py-0.5 ${active ? "bg-accent" : ""}`}>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.8} />
                </span>
                <span className={`text-[10px] ${active ? "font-bold" : "font-medium"}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

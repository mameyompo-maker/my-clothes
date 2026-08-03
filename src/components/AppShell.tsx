"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { BottomNav } from "./BottomNav";
import { isFirebaseConfigured } from "@/lib/firebase";

const PUBLIC_PATHS = ["/onboarding"];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // サインイン済みの人を /onboarding から追い出す処理は、ここではなく onboarding ページ側が持つ。
  // 招待リンク(/onboarding?invite=XXXX)は開いた時点で既にサインイン済みのことが多く、
  // ここで問答無用に /feed へ飛ばすと招待コードが処理される前に画面が消えてしまうため。
  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath) {
      router.replace("/onboarding");
    }
  }, [loading, user, isPublicPath, router]);

  if (!isFirebaseConfigured) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">Firebaseの設定が必要です</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          `.env.local` に Firebase プロジェクトの設定値を入力してから、開発サーバーを再起動してください。
          手順は README.md を参照してください。
        </p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </main>
    );
  }

  return (
    <>
      <main className={isPublicPath ? "min-h-dvh" : "min-h-dvh pb-24"}>{children}</main>
      {!isPublicPath && user && <BottomNav />}
    </>
  );
}

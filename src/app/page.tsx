import { redirect } from "next/navigation";

/**
 * ルートはホームへ送るだけ。
 *
 * 以前はクライアント側で `router.replace("/feed")` していたので、
 * 「/ を読む → JS を読む → 起動する → /feed へ移る → /feed の JS を読む」と
 * 一往復ぶん余計に待っていた。サーバー側のリダイレクトなら、ブラウザは
 * 最初から /feed を取りに行く(PWAの start_url は元から /feed なので、
 * これが効くのはURLを直接開いた場合)。
 */
export default function RootPage() {
  redirect("/feed");
}

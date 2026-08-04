"use client";

import type { Unsubscribe } from "firebase/firestore";
import { watchPublicStylePosts } from "./firestore";
import type { StylePost } from "@/types/models";

/**
 * 画面をまたいで「同じデータの購読」を1本にまとめるための小さなストア。
 *
 * これを入れた理由(Kazさんの「開いてから動き出すまでが遅い」への対応):
 *  - ホームと検索が **それぞれ別に** 公開タイムラインを購読していたので、
 *    検索を開くたびに同じ投稿をもう一度読んでいた。
 *  - 画面を移動すると購読が毎回捨てられ、戻るたびにゼロから読み直していた。
 *    Firestore の永続キャッシュがあっても、接続の確立とクエリの往復はやり直しになる。
 *
 * 対策は2つだけ。**購読を共有する**ことと、**最後の購読者が消えても少しの間は
 * 生かしておく**こと。タブを行き来する程度の移動では、戻った瞬間に前回の値が
 * そのまま出る(=スケルトンが出ない)。
 */

/** 最後の購読者が離れてから、購読を生かしておく時間。タブ移動を跨ぐのが目的。 */
const LINGER_MS = 90_000;

interface Room<T> {
  value: T | null;
  listeners: Set<(v: T) => void>;
  unsub: Unsubscribe | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

function createRoom<T>(start: (emit: (v: T) => void) => Unsubscribe) {
  const room: Room<T> = { value: null, listeners: new Set(), unsub: null, closeTimer: null };

  return function subscribe(cb: (v: T) => void): () => void {
    room.listeners.add(cb);
    if (room.closeTimer) {
      clearTimeout(room.closeTimer);
      room.closeTimer = null;
    }
    // 既に値を持っていれば、待たせずその場で渡す。ここが「戻ったら即表示」の要。
    if (room.value !== null) cb(room.value);
    if (!room.unsub) {
      room.unsub = start((v) => {
        room.value = v;
        room.listeners.forEach((l) => l(v));
      });
    }
    return () => {
      room.listeners.delete(cb);
      if (room.listeners.size > 0 || room.closeTimer) return;
      room.closeTimer = setTimeout(() => {
        room.closeTimer = null;
        if (room.listeners.size > 0) return;
        room.unsub?.();
        room.unsub = null;
        // 値は捨てない。次に開いたとき、サーバーの返事を待たずに前回の並びを出せる。
      }, LINGER_MS);
    };
  };
}

/**
 * 公開タイムライン(ホーム・検索の共通の材料)。
 * 件数は40件。以前は100件だったが、1画面で読み切れる量ではないうえ、
 * カードごとの画像読み込みが重なって初速を殺していた。
 */
export const subscribePublicPosts = createRoom<StylePost[]>((emit) =>
  watchPublicStylePosts(emit, 40)
);

/**
 * 1回だけ読めば十分なものを、画面をまたいで使い回すためのメモ化。
 *
 * 「おすすめの人」や公式アカウント一覧は、ホームを開くたびに読み直す必要がない。
 * 進行中の Promise も共有するので、同時に2箇所から呼ばれても往復は1回で済む。
 */
const onceCache = new Map<string, { at: number; value: Promise<unknown> }>();

export function cachedOnce<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = onceCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = loader().catch((e) => {
    // 失敗はキャッシュしない。次の呼び出しでやり直せるようにする。
    onceCache.delete(key);
    throw e;
  });
  onceCache.set(key, { at: Date.now(), value });
  return value;
}

/** フォローした直後など、作り直したいときに使う。 */
export function invalidateOnce(prefix: string): void {
  for (const key of Array.from(onceCache.keys())) {
    if (key.startsWith(prefix)) onceCache.delete(key);
  }
}

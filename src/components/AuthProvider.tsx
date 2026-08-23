"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, googleAuthProvider, isFirebaseConfigured } from "@/lib/firebase";
import {
  ensureUserProfile,
  getMyAiKey,
  getMyStylistKey,
  getUserProfile,
  getUserProfileFromCache,
  listBlockedByUids,
  listBlockedUids,
  listFollowingUids,
  listMyLikedPostIds,
  listMySavedPostIds,
} from "@/lib/firestore";
import type { UserProfile } from "@/types/models";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<User>;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * 自分がブロックした相手 + 自分をブロックした相手。
   *
   * どの画面でも同じ基準で除外できるよう、ここで一度だけ読んで配っている。
   * 表示のたびに引くと読み取り課金がフィードの件数ぶん増えるため。
   */
  hiddenUids: Set<string>;
  refreshBlocks: () => Promise<void>;
  /** 自分がフォローしている相手。フィード・2択一覧・おすすめが共通で使う。 */
  followingUids: string[];
  refreshFollowing: () => Promise<void>;
  /**
   * 自分のAPIキー(Google AI Studio か OpenAI)を登録済みか。
   * AI合成は各自のキーで走るので、未登録の人には合成を発火させない
   * (発火させても関数側で failed-precondition になるだけで無駄になる)。
   * キーそのものはここには持たない。必要になるのはサーバー側だけなので。
   */
  hasAiKey: boolean;
  /** コーデを考える役(Claude)のキーを登録済みか。AI合成とは別の機能。 */
  hasStylistKey: boolean;
  refreshAiKey: () => Promise<void>;
  /**
   * 自分が「いいね」「保存」した投稿ID。
   *
   * **カードごとに問い合わせないための一括取得**。以前は1枚につき2往復していて、
   * 20枚並ぶだけで40回の往復になっていた(ホームが重かった主因)。
   */
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  /**
   * 一括取得の状態。
   *  - `loading`: まだ読んでいる。**カード側はここで個別問い合わせをしないこと**
   *    (ここで問い合わせると、一括取得を入れた意味が無くなって元の往復数に戻る)
   *  - `ready`: 上の2つの集合が正。
   *  - `unavailable`: 索引が無いなどで引けなかった。カード側が1件ずつ確認する経路に落ちる。
   */
  reactions: "loading" | "ready" | "unavailable";
  setLikedLocal: (postId: string, liked: boolean) => void;
  setSavedLocal: (postId: string, saved: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 中身が同じなら同じ Set を使い回す。無駄な再購読・再取得の連鎖を止めるため。 */
function sameMembers(a: Set<string>, b: string[]): boolean {
  if (a.size !== b.length) return false;
  return b.every((x) => a.has(x));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [hiddenUids, setHiddenUids] = useState<Set<string>>(new Set());
  const [followingUids, setFollowingUids] = useState<string[]>([]);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<"loading" | "ready" | "unavailable">("loading");
  const [hasAiKey, setHasAiKey] = useState(false);
  const [hasStylistKey, setHasStylistKey] = useState(false);
  const uidRef = useRef<string | null>(null);

  const applyHidden = useCallback((list: string[]) => {
    setHiddenUids((prev) => (sameMembers(prev, list) ? prev : new Set(list)));
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      uidRef.current = firebaseUser?.uid ?? null;
      if (firebaseUser) {
        const uid = firebaseUser.uid;
        // 起動を速くするための2段構え:
        //  1. 付帯データ(ブロック・フォロー・いいね/保存)は画面表示を待たせない。
        //     すべて裏で並列に読み、届いた順に反映する。
        //  2. プロフィールはまずローカルキャッシュで即描画し、サーバー確定値で置き換える。
        // 以前は「プロフィール → ブロック2本」を直列で待ってから描画しており、
        // ネットワーク往復3回ぶんスピナーを見せていた。
        void Promise.all([
          listBlockedUids(uid).catch(() => [] as string[]),
          listBlockedByUids(uid).catch(() => [] as string[]),
        ]).then(([mine, theirs]) => applyHidden([...mine, ...theirs]));

        void listFollowingUids(uid)
          .then(setFollowingUids)
          .catch(() => setFollowingUids([]));

        // いいね/保存は collectionGroup で1回ずつ。索引が無い環境だけ
        // "unavailable" にして、カード側の個別確認に任せる。
        void Promise.all([listMyLikedPostIds(uid), listMySavedPostIds(uid)])
          .then(([liked, saved]) => {
            setLikedPostIds(new Set(liked));
            setSavedPostIds(new Set(saved));
            setReactions("ready");
          })
          .catch((e) => {
            console.warn("いいね/保存の一括取得に失敗。個別確認に落ちます", e);
            setReactions("unavailable");
          });

        const cached = await getUserProfileFromCache(uid);
        if (cached) {
          setProfile(cached);
          setLoading(false);
        }
        const p = await ensureUserProfile(uid, firebaseUser.displayName ?? "名無しさん", firebaseUser.photoURL);
        setProfile(p);
      } else {
        setProfile(null);
        setHiddenUids(new Set());
        setFollowingUids([]);
        setLikedPostIds(new Set());
        setSavedPostIds(new Set());
        setReactions("loading");
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [applyHidden]);

  async function signInWithGoogle() {
    if (!auth) throw new Error("Firebaseが未設定です。.env.local を確認してください。");
    const credential = await signInWithPopup(auth, googleAuthProvider);
    // onAuthStateChangedのstate反映を待たず、呼び出し側がuidを即座に使えるようにする。
    await ensureUserProfile(
      credential.user.uid,
      credential.user.displayName ?? "名無しさん",
      credential.user.photoURL
    );
    return credential.user;
  }

  async function signOutUser() {
    if (!auth) return;
    await signOut(auth);
  }

  async function refreshProfile() {
    if (!user) return;
    setProfile(await getUserProfile(user.uid));
  }

  async function refreshBlocks() {
    if (!user) return;
    const [mine, theirs] = await Promise.all([
      listBlockedUids(user.uid).catch(() => [] as string[]),
      listBlockedByUids(user.uid).catch(() => [] as string[]),
    ]);
    applyHidden([...mine, ...theirs]);
  }

  const refreshAiKey = useCallback(async () => {
    if (!user) {
      setHasAiKey(false);
      setHasStylistKey(false);
      return;
    }
    try {
      // 同じ userSecrets ドキュメントを2回読むが、2回目は永続キャッシュから返るので
      // 往復は増えない。読み方を1本にまとめるより、呼び出し側が素直になる。
      const [ai, stylist] = await Promise.all([getMyAiKey(user.uid), getMyStylistKey(user.uid)]);
      setHasAiKey(Boolean(ai));
      setHasStylistKey(Boolean(stylist));
    } catch {
      // 読めなくても致命的ではない。未登録として扱い、合成を発火させないだけ。
      setHasAiKey(false);
      setHasStylistKey(false);
    }
  }, [user]);

  useEffect(() => {
    // effect 本体から同期に setState するとレンダリングが連鎖するので、
    // 一度マイクロタスクに逃がしてから反映する(このファイルの他の購読と同じ扱い)。
    queueMicrotask(() => void refreshAiKey());
  }, [refreshAiKey]);

  const refreshFollowing = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    setFollowingUids(await listFollowingUids(uid).catch(() => []));
  }, []);

  const setLikedLocal = useCallback((postId: string, liked: boolean) => {
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(postId);
      else next.delete(postId);
      return next;
    });
  }, []);

  const setSavedLocal = useCallback((postId: string, saved: boolean) => {
    setSavedPostIds((prev) => {
      const next = new Set(prev);
      if (saved) next.add(postId);
      else next.delete(postId);
      return next;
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      signInWithGoogle,
      signOutUser,
      refreshProfile,
      hiddenUids,
      refreshBlocks,
      followingUids,
      refreshFollowing,
      hasAiKey,
      hasStylistKey,
      refreshAiKey,
      likedPostIds,
      savedPostIds,
      reactions,
      setLikedLocal,
      setSavedLocal,
    }),
    // signIn/signOut/refresh* は毎回作り直されるが、依存に入れると値が毎回変わって
    // 下流の useEffect を無駄に走らせる。実体は state を読むだけなので除外している。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, profile, loading, hiddenUids, followingUids, likedPostIds, savedPostIds, reactions, refreshFollowing, hasAiKey, hasStylistKey, refreshAiKey, setLikedLocal, setSavedLocal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

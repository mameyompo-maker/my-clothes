"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, googleAuthProvider, isFirebaseConfigured } from "@/lib/firebase";
import { ensureUserProfile, getUserProfile, listBlockedByUids, listBlockedUids } from "@/lib/firestore";
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [hiddenUids, setHiddenUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const p = await ensureUserProfile(firebaseUser.uid, firebaseUser.displayName ?? "名無しさん", firebaseUser.photoURL);
        setProfile(p);
        // ブロックの読み込みに失敗しても、アプリ自体は使えるようにしておく。
        const [mine, theirs] = await Promise.all([
          listBlockedUids(firebaseUser.uid).catch(() => [] as string[]),
          listBlockedByUids(firebaseUser.uid).catch(() => [] as string[]),
        ]);
        setHiddenUids(new Set([...mine, ...theirs]));
      } else {
        setProfile(null);
        setHiddenUids(new Set());
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

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
    setHiddenUids(new Set([...mine, ...theirs]));
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signOutUser, refreshProfile, hiddenUids, refreshBlocks }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

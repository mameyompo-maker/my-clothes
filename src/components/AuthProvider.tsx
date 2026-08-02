"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, googleAuthProvider, isFirebaseConfigured } from "@/lib/firebase";
import { ensureUserProfile, getUserProfile } from "@/lib/firestore";
import type { UserProfile } from "@/types/models";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<User>;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const p = await ensureUserProfile(firebaseUser.uid, firebaseUser.displayName ?? "名無しさん", firebaseUser.photoURL);
        setProfile(p);
      } else {
        setProfile(null);
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

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signOutUser, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** True once every required Firebase env var is present, i.e. `.env.local` has been filled in. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

export const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;

/**
 * Firestore は IndexedDB の永続キャッシュ付きで初期化する。
 *
 * 2回目以降の起動では、フィードやクローゼットの onSnapshot がまずキャッシュから
 * 即座に返り、その後サーバーの最新で置き換わる。「開いてから動き出すまでが遅い」
 * という体感の大部分は初回のネットワーク往復なので、これが一番効く。
 * プライベートブラウズ等で IndexedDB が使えない環境ではメモリキャッシュに落とす。
 */
function createDb(): Firestore | null {
  if (!app) return null;
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();

/**
 * Storage SDK は「使う瞬間まで読み込まない」。
 *
 * ここを `import { getStorage } from "firebase/storage"` と静的に書いていたころは、
 * lib/firestore.ts → AuthProvider → root layout と連鎖して、**写真を1枚も
 * 扱わない画面(ホーム・2択・DM・カレンダー等)にまで Storage SDK が乗っていた**。
 * 実際に触るのは uploadImage ただ1つなので、動的 import にして初回に落ちてくる
 * JSから丸ごと外してある。2回目以降は解決済みの Promise を返すだけ。
 */
let storagePromise: Promise<import("firebase/storage").FirebaseStorage> | null = null;

export function loadStorage(): Promise<import("firebase/storage").FirebaseStorage> {
  if (!app) return Promise.reject(new Error("Firebaseが未設定です。.env.local を確認してください。"));
  const ready = app;
  storagePromise ??= import("firebase/storage").then((m) => m.getStorage(ready));
  return storagePromise;
}
export const googleAuthProvider = new GoogleAuthProvider();

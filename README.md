# My Clothes

朝のコーデ選びを、友達と一緒に。クローゼットの写真をあらかじめ登録しておき、その日の気分や予定を添えて2つのコーデ候補を投稿すると、選んだ友達が2択タップで投票してくれるアプリです。投稿は24時間で自動的に消えます。

## 主な機能

- **クローゼット**: トップス/ボトムス/アウター/シューズ/アクセサリーの5カテゴリーで服を撮影・登録。初回は普遍的な服10種類がサンプルとして自動で入る。
- **顔パターン**: 髪型・メイク違いの顔写真を最大5枚登録し、毎日の投稿時にその場で撮る代わりに選ぶだけでも使える。
- **コーデ投稿**: クローゼットから服を選んで候補A/Bを作成し、今日の気分・予定を添えて投稿。共有する友達を選べる。
- **AI合成(任意)**: 服の写真+顔写真を画像編集モデルに渡し、実際に着用しているような1枚の合成画像を生成。**利用者が自分のAPIキーを登録したときだけ動く**(未登録でもアプリは全部使え、その場合は服を並べた表示になる)。キーは **Google AI Studio と OpenAI のどちらでもよい**(貼られた文字列の形で自動判別)。登録は「最初の登録画面」と「プロフィール編集画面」の両方からできる。
- **投票**: 友達は候補A/Bを横並び2択タップで投票。投票すると票数が見える。
- **招待制の友達関係**: 招待コード/リンクで友達を追加。投稿は招待コードで繋がった友達の中から選んで共有。

## 技術スタック

- Next.js 16 (App Router, TypeScript, Tailwind CSS v4) — Web PWA
- Firebase (Authentication / Firestore / Storage)
- Firebase Cloud Functions + 画像編集モデル(Gemini / OpenAI)によるコーデ合成 — **任意。各利用者が自分のAPIキーを登録して使う(費用も各自負担)**

友達招待は Cloud Functions を使わず、Firestore のセキュリティルールだけで「招待コードを知っている人が自分自身を相手の友達リストに追加する」処理を完結させている(`src/lib/firestore.ts` の `redeemInviteCode`)。

### 課金プランについて(重要)

Firebase には無料の **Spark プラン**と、従量課金の **Blaze プラン**があるが、**2026年2月3日以降、Cloud Storage(写真の保存)はBlazeプランでないと一切使えない**(Sparkのままだとバケットへのアクセスが402/403エラーになる。Firestore/Authentication/Hostingは引き続きSparkのままカード登録なしで無料利用できる)。

このアプリはクローゼットの写真や顔パターンをStorageに保存するため、**Blazeプランへのアップグレード(支払い方法の登録)が実質必須**になる。ただしBlazeにしても無料枠(ストレージ5GB、ダウンロード1日1GBなど)はそのまま適用され、それを超えない限り請求額は0円。アップロード前にブラウザ側で画像を自動圧縮する処理(`src/lib/image.ts`)も入れてあり、個人〜少人数規模なら無料枠に収まりやすい。

## ディレクトリ構成(抜粋)

```
src/
  app/            App Router のページ(onboarding / closet / create / feed / profile)
  components/     AuthProvider, BottomNav, AppShell などの共通UI
  lib/            Firebase クライアント初期化・Firestoreヘルパー(友達招待もここ)・画像圧縮・Cloud Functions呼び出し
  types/          データモデルの型定義
  data/           初期シードデータ(服10種)
functions/        Firebase Cloud Functions(Gemini合成のみ。任意機能)
firestore.rules   Firestore セキュリティルール
storage.rules     Storage セキュリティルール
```

## セットアップ手順

もっと細かいクリック単位の手順は、Kazさん専用に作った [セットアップガイド(チェックリスト付き)](https://claude.ai/code/artifact/fae4ed4a-4308-47dd-b9a3-9ff2334e3eb3) も参照。

### 1. Firebaseプロジェクトを作成

1. [Firebaseコンソール](https://console.firebase.google.com/)で新規プロジェクトを作成。
2. **Authentication** → Sign-in method で **Google** を有効化(Sparkのままで可)。
3. **Firestore Database** を作成(本番モードでOK。ルールは後述の手順で反映する。Sparkのままで可)。
4. **Storage** を作成しようとすると、プランのアップグレードを求められる。案内に従って
   **Blazeプラン(従量課金)** へアップグレードする(支払い方法の登録が必要。前述の通り、
   個人〜少人数規模なら実際の請求は0円で収まりやすい)。
5. プロジェクトの設定 → マイアプリ → ウェブアプリを追加し、表示された設定値を控える。

### 2. Webアプリ側の環境変数

```bash
cp .env.local.example .env.local
```

`.env.local` に手順1で控えた `NEXT_PUBLIC_FIREBASE_*` の値を入力する。

### 3. 依存関係のインストールと起動

```bash
npm install
npm run dev
```

`http://localhost:3000` を開く。`.env.local` が未設定の間は「Firebaseの設定が必要です」という案内だけが表示される。

### 4. Firebase CLIでセキュリティルールをデプロイ

```bash
npm install -g firebase-tools   # 未インストールの場合
firebase login
cp .firebaserc.example .firebaserc   # "your-firebase-project-id" を実際のプロジェクトIDに書き換え
firebase deploy --only firestore:rules,storage
```

ここまでで、クローゼット登録・招待コードでの友達追加・コーデ投稿・2択投票まで一通り動く(AI合成だけ「準備中」のまま服の写真がそのまま表示される)。

### 5. 少人数で試す

`localhost:3000` は自分のPCからしか開けない。同じWi-Fiにいる相手となら、`npm run dev` 実行時に表示される
`Network: http://192.168.x.x:3000` のアドレスをそのまま使える。離れた相手と試したくなったら、後述の
「Vercelで公開する」を行う(これも無料)。

## AI合成について(運営側の設定は不要)

**2026-08-06 以降、合成は利用者それぞれが自分のAPIキーで行う。**
運営が `GEMINI_API_KEY` をシークレットに登録する必要はもう無い(登録しても使われない)。
利用者は**最初の登録画面**か**プロフィール編集画面**からキーを登録する。詳しくは後述の
「AI合成は利用者それぞれのAPIキーで動く」を参照。

**2026-08-22 以降、Google と OpenAI の両方のキーを受け付ける。** どちらかを利用者に
選ばせるのではなく、貼られた文字列の先頭(`AIza` / `sk-`)で機械的に判別する。
判別規則は `src/lib/aiProviders.ts` と `functions/src/index.ts` の `detectProvider` の
**両方**にあるので、片方だけ変えないこと。

使うモデルだけはコード側の設定。`functions/src/index.ts` の `GEMINI_IMAGE_MODEL`
(既定 `gemini-3.1-flash-image`)と `OPENAI_IMAGE_MODEL`(既定 `gpt-image-2`)。
モデル名は変わりやすいので、変更前に https://ai.google.dev/gemini-api/docs/models と
https://developers.openai.com/api/docs/models で最新の識別子を確認すること。

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

## 友達も使えるように公開する(Vercel・無料)

Vercelの無料枠(Hobbyプラン)で公開できる。課金は発生しない。まだ広く公開したくない場合は
このステップ自体を飛ばしてよい(URLを知っている人しか実質使えないので、身内テストの範囲では
公開してしまっても大きな問題はない)。

1. [Vercel](https://vercel.com/)にGitHubアカウントでログインし、このリポジトリをImport。
2. Environment Variables に `.env.local` と同じ `NEXT_PUBLIC_FIREBASE_*` を登録してDeploy。
3. 発行されたURL(例: `my-clothes.vercel.app`)をFirebaseコンソール →
   **Authentication → Settings → 承認済みドメイン** に追加する
   (これを忘れるとVercel上のGoogleサインインが失敗する)。

### AI合成は利用者それぞれのAPIキーで動く(2026-08-06 変更)

**運営のキーは使っていない。** 各利用者がプロフィール編集画面で自分の
[Google AI Studio](https://aistudio.google.com/apikey) のAPIキーを登録し、そのキーで合成が走る。
生成費用は各自の Google アカウントに請求される。

- キーの保存先は Firestore の **`userSecrets/{uid}`**。ルールで**本人しか読み書きできない**。
  `users` は「サインインしていれば誰でも読める」ルールなので、**そちらには絶対に置かない**。
  フィールド名 `geminiApiKey` は Google 専用だった頃の名残で、中身は OpenAI のキーのことも
  ある。`provider` と必ず組で扱うこと(改名すると既存の登録が読めなくなる)。
- Cloud Functions が Admin SDK でキーを読み、呼び出した本人のキーで Gemini を叩く。
  未登録なら「プロフィール編集画面から登録してください」と返す。
- プロフィール編集画面の「使えるか確認」は `verifyGeminiKey` 関数が保存済みのキーで実際にAPIを叩く。
  **キーの中身はクライアントに返さない。**
- 費用の目安: `gemini-3.1-flash-image` は1枚約$0.067(約10円)。2択1回で2枚生成するので約20円。
- **キーを登録しなくてもアプリは全部使える。** その場合は `LookFigure` / `OutfitCard` が
  顔写真と選んだ服を並べて表示する。

過去に「一度も合成が成功しない」状態が続いた原因(同じ症状を疑うときの手がかり):
クライアントと関数のリージョン不一致、Secret Manager のキーが壊れていた、
見本画像が相対パスでサーバーから取得できなかった、Cloud Run の invoker 権限が空だった、の4つ。
詳細は `HANDOVER.md` の「今回のセッションで直したバグ」を参照。

### おすすめ提案について

`src/lib/recommend.ts` は外部APIを使わない。季節・本人の好きなジャンル・最後に着てからの日数だけで
スコアリングしている。Gemini の課金状況に関係なく動き、費用もかからない。

## 現状の実装状況 / 今後のTODO

- 画面・データモデル・Firestore/Storageルールは実装済み。実際のFirebaseプロジェクトでの通し確認はこれから。AI合成(Cloud Functions + Gemini)はAPIキー未設定のため未検証。
- 通知機能は今回のスコープ外(投票状況はアプリを開いたときに確認する想定)。
- 認証はGoogleサインインのみ実装。他の方式が必要な場合は `src/components/AuthProvider.tsx` を拡張してください。
- PWAのオフライン対応(Service Worker)は未実装。マニフェスト(`src/app/manifest.ts`)とアイコンのみ用意済み。
- クローゼットアイテム・顔パターンの削除・編集UIは未実装(登録のみ)。

## アイコン再生成

`public/icons/` のPWAアイコンは `scripts/generate-icons.mjs` で生成しています。ロゴを変更したい場合はこのスクリプトを編集して再実行してください。

```bash
node scripts/generate-icons.mjs
```

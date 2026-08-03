# My Clothes

朝のコーデ選びを、友達と一緒に。クローゼットの写真をあらかじめ登録しておき、その日の気分や予定を添えて2つのコーデ候補を投稿すると、選んだ友達が2択タップで投票してくれるアプリです。投稿は24時間で自動的に消えます。

## 主な機能

- **クローゼット**: トップス/ボトムス/アウター/シューズ/アクセサリーの5カテゴリーで服を撮影・登録。初回は普遍的な服10種類がサンプルとして自動で入る。
- **顔パターン**: 髪型・メイク違いの顔写真を最大5枚登録し、毎日の投稿時にその場で撮る代わりに選ぶだけでも使える。
- **コーデ投稿**: クローゼットから服を選んで候補A/Bを作成し、今日の気分・予定を添えて投稿。共有する友達を選べる。
- **AI合成(任意)**: 服の写真+顔写真を Gemini の画像編集モデルに渡し、実際に着用しているような1枚の合成画像を生成。**有効化しなくてもアプリは動く**(未合成の間は服の写真をそのまま並べて表示する)。
- **投票**: 友達は候補A/Bを横並び2択タップで投票。投票すると票数が見える。
- **招待制の友達関係**: 招待コード/リンクで友達を追加。投稿は招待コードで繋がった友達の中から選んで共有。

## 技術スタック

- Next.js 16 (App Router, TypeScript, Tailwind CSS v4) — Web PWA
- Firebase (Authentication / Firestore / Storage)
- Firebase Cloud Functions + Gemini API(画像編集モデル)によるコーデ合成 — **任意。使う場合のみ追加の課金設定が必要**

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

## AI合成を有効化する(任意)

服+顔写真を1枚のコーデ写真に合成したくなったら、ここから先を行う。**Gemini
の画像生成には無料枠が一切なく**(2026-08時点で公式ドキュメントで確認済み)、課金設定は
すでに前述のBlazeアップグレードで済んでいるはずなので、ここでは主にAPIキーの取得が中心。

1. [Google AI Studio](https://aistudio.google.com/) でGemini APIキーを取得。既存の汎用キーと
   同じものを使い回すのではなく新規に発行し、紐づけ先のGoogle Cloudプロジェクトは
   `my-clothes-46c81`(実際のプロジェクトIDに読み替え)を選ぶと、課金・利用状況がこのアプリの
   Firebaseリソースとまとまって把握しやすい。
2. デフォルトでは `functions/src/index.ts` の `GEMINI_IMAGE_MODEL` に標準グレードの
   `gemini-3.1-flash-image` を設定済み。コストを抑えたい場合は `gemini-3.1-flash-lite-image`
   (安価)に、画質を上げたい場合は `gemini-3-pro-image`(高品質・高コスト)に変更できる。
   モデル名は変わりやすいので、デプロイ前に https://ai.google.dev/gemini-api/docs/models で
   最新の識別子を確認すること。
3. シークレットを登録してデプロイ:

```bash
firebase functions:secrets:set GEMINI_API_KEY
cd functions
npm install
cd ..
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

### AI合成の現状(2026-08-03 時点)

**動作する。** 過去に一度も動いていなかった不具合を解消し、クレジット追加後に実機で画像生成を確認済み。
経緯は以下のとおり(同じ問題を疑うときの手がかりとして残す)。

- 過去に一度も動いていなかった原因は2つ。①クライアントが `asia-northeast1`、関数が `us-central1` に
  デプロイされていてエンドポイントが存在しなかった ②Secret Manager の `GEMINI_API_KEY` が壊れた値
  (32文字・`AIza`始まりでない・空白混入)で `API_KEY_INVALID` だった。いずれも修正済み。
- 修正後も一時 `429 RESOURCE_EXHAUSTED: Your prepayment credits are depleted` で止まっていた。
  Gemini API は AI Studio 側の**前払いクレジット**で動いており、Firebase の Blaze 課金とは別勘定。
  https://ai.studio/projects でクレジットを追加して解消済み。再び429が出たらここを疑うこと。
- 費用の目安: `gemini-3.1-flash-image` は1枚約$0.067(約10円)。2択1回で2枚生成するので約20円。
- **合成が無くてもアプリは完結する。** `src/components/OutfitCard.tsx` が、合成画像が無い場合に
  撮影した顔写真と選んだ服をボード状に並べて表示する。顔写真が無駄にならないようにするための作り。

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

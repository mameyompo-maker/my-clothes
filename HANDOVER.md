# HANDOVER — my_clothes(ファッションコーデアプリ)

最終更新: 2026-08-03 / 前セッションからの引き継ぎメモ。**新しいセッションを始めたらこれを最初に読むこと。**

- 公開URL: https://my-clothes-three.vercel.app
- リポジトリ: https://github.com/mameyompo-maker/my-clothes (master 直押し運用)
- ローカル: `C:\Users\kazdr\dev\my_clothes` (**OneDrive外のローカルディスク**。同期されていない)
- Firebase プロジェクト: `my-clothes-46c81`
- 最新コミット: `1cafaea`

---

## 0. まず把握すべき現状

| 項目 | 状態 |
|---|---|
| アプリ本体 | 稼働中。全21ルート、lint/build ともにエラーなし |
| Gemini AI合成 | **動く状態になった**(2026-08-03 に実機で画像生成を確認) |
| 2択・クローゼット・投稿・フォロー・DM・カレンダー | 実装済み・デプロイ済み |
| 課金(Stripe) | **コードのみ完成。Stripe側の設定が未着手**。ボタンは環境変数で非表示 |
| 特定商取引法の表記 | **未記入**。埋めるまで課金開始は不可(法令違反になる) |
| Cloud Functions | `composeOutfitImage` のみデプロイ済み。**Stripe系3関数は未デプロイ** |

### Kazさんの操作が必要に残っていること

1. **Stripe アカウント作成と設定** → 手順は `BILLING_SETUP.md` に全部書いてある。テストモードなら審査を待たず試せる。
2. **月額の金額を決める**(未決定)。
3. **特商法の表記を埋める** → `src/app/legal/tokushoho/page.tsx` の `ROWS` で `value: null` の項目。
4. テストキーが用意できたら、**Stripe関数のデプロイと動作確認は次のセッションで代行できる**。

---

## 1. このアプリの目的(ぶれさせないこと)

**朝の服選びの時間を短縮する**のが主目的。2択を作って友達に選んでもらい、選ばれた方を着る、という流れが中核。
SNS機能(公開投稿・フォロー・DM)は後から足したもので、主目的を邪魔しないように配置している。

- ターゲット: 主に大学生くらいの女性。10代〜30代が使える水準。
- 参考にしたUI: Instagram / BeReal / WEAR。
- 2択を作れるのは **1日1回**(朝に決め切る運用に寄せるため)。

---

## 2. 今回のセッションで直したバグ(同じ轍を踏まないために)

すべて「一見動いているように見えるが、実は一度も成功していなかった」類のもの。
**共通する教訓: 症状から推測せず、実データ・ログ・git履歴を先に見る。**

### ① AI合成が一度も動いていなかった(原因2つ)

- **リージョン不一致**: クライアントが `asia-northeast1`、関数が `us-central1`。存在しないエンドポイントを叩いていた。
  → 両方を `us-central1` に統一。`src/lib/functions.ts` の `CALLABLE_REGION` と
  `functions/src/index.ts` の `FUNCTION_REGION` にコメントで「必ず一致させること」と明記済み。
- **APIキーが壊れていた**: Secret Manager の値が32文字・`AIza`始まりでない・空白混入で `API_KEY_INVALID`。
  → 専用キーを新規発行して登録(version 3)。

なお当初これを「一時的な問題」と誤って説明した。真因は `firebase.json` の `ignore` に `lib` が入っていたことで、
それは別セッションで既に修正済みだった。**再実行で直ったときこそ「なぜ直ったか」を確認すること。**

### ② 画面下のボタンが全部押せなかった

`BottomNav` が `fixed bottom-0 z-40`、各画面の操作バーが `bottom-0 z-30` で、**完全に裏に隠れていた**。
投稿ボタン・DMの入力欄・コメント欄がすべて機能不全。
→ `ActionBar` コンポーネント(`src/components/ui.tsx`)に集約し、`--nav-h` 分だけ持ち上げるようにした。
**画面下に固定要素を足すときは必ず `ActionBar` を使うか、同じ計算で持ち上げること。**

### ③ 全身写真の投稿が必ず失敗していた

`storage.rules` に `styles/` のルールが無く、Firebaseは未定義パスを既定で拒否する。
→ `styles/` と `avatars/` を追加。

### ④ DMが一度も使えなかった(ルールの落とし穴)

`chatThreads` が本番で0件だった。原因は **Firestoreでは存在しないドキュメントの `get` で `resource` が `null` になる**こと。
`me() in resource.data.memberUids` を無条件に書いていたため評価エラー→権限拒否となり、
「スレッドの存在確認」で必ず落ちて作成に到達できなかった。
→ `get` のみ `resource == null` を許可、`list` はメンバー限定のまま。`stylePosts` / `outfitPosts` も同じ形だったので同様に修正。

**このパターンは再発しやすい。新しいコレクションのルールを書くときは「存在しないドキュメントを読む経路があるか」を必ず確認すること。**

---

## 3. 実装済みの機能

### 中核(2択)
- 決め方を2つから選択: **「上から順に選ぶ」**(アウター→トップス→ボトムス→靴。次に選ぶ場所に「←今ここ」表示)/ **「主役から選ぶ」**。
- 2択を作成 → 友達が投票 → 「こっちを着る」で確定 → 着用回数を加算しカレンダーに記録 → 全身写真投稿へ導線。
- **友達ゼロでも作成・保存できる。**
- 1日1回制限(`hasCreatedOutfitToday`)。**クライアント側チェックのみ**。ルールでは件数を数えられないため、
  厳密にするならCloud Functions経由の作成に変える必要がある。

### AI合成
- `composeOutfitImage`(Cloud Functions, us-central1)が顔写真+服の写真をGeminiに渡して1枚に合成。
- モデル: `gemini-3.1-flash-image`。`functions/.env` の `GEMINI_IMAGE_MODEL` で変更可。
- **合成が無い/失敗/処理中でも `OutfitCard` が顔写真+服をボード状に必ず表示する。**
  「顔を撮ったのに映らない」という指摘への対処であり、課金が切れても破綻しない設計。

### 費用の目安(2026-08時点、公式料金で確認済み)
- `gemini-3.1-flash-image`: 出力 $60/1M tokens、1枚=1,120 tokens → **1枚約$0.067(約10円)**
- 2択1回で2枚生成 → **約20円**。2,000円で**約100回**。
- 安価版 `gemini-3.1-flash-lite-image` は半額(1枚約5円)。高品質 `gemini-3-pro-image` は約20円/枚。
- 入力(画像6枚程度)は1回0.5円未満で無視できる。

### クローゼット
- ブランド / サイズ / 色 / ジャンル(10種) / 季節 / メモ を登録。カテゴリー7種(ワンピース・バッグ含む)。
- ジャンル・季節・カテゴリーで絞り込み。**季節タグ未設定の服は通年扱いで常に表示**(登録直後に消えると混乱するため)。
- **ハンガー表示**(`HangerRail`): レールから吊り下がり、揺れ、タップで持ち上がる。
- 編集・削除、着用回数の記録。

### 投稿・SNS
- **全身写真の投稿**: 写真をタップした位置にアイテムタグを置ける(WEAR方式)。公開範囲は「みんな」/「友達だけ」。
  **友達ゼロでも公開できる。** 2択で確定した直後に投稿すると、その服が自動でタグの初期値に入る。
- 公開タイムライン、ダブルタップいいね、コメント、フォロー/フォロワー、ユーザー検索(@ハンドル前方一致)。
- **DM**(E2E暗号化なし、指示どおり)。フォローしている相手なら誰とでも開始可能。

### プロフィール
- @ハンドル、自己紹介、身長、骨格タイプ、パーソナルカラー、サイズ3種、好きなジャンル。
- **お気に入りコーデを3つまで固定表示**(自分・他人の両方の画面。他人からは非公開投稿を除外)。
- **アイコン変更はプロフィール編集画面**にある(プロフィール画面ではない)。
  `<input accept="image/*">` から `capture` を**意図的に外している**。付けるとカメラが直接起動し、
  端末保存済みの写真から選べなくなるため。

### カレンダー
- 月グリッドに その日着たコーデのサムネイル。全身写真優先、無ければ確定した2択の服の写真。

### 「友達」の定義
**お互いにフォローしている相手 = 友達。** 相互フォロー成立で自動的に友達になり、片方が外すと解除。
招待コードはフォローを張ったうえで友達にする扱い。`friendUids` はその状態の非正規化キャッシュ。

---

## 4. 課金機能(Stripe)

### 実装済み
| ファイル | 役割 |
|---|---|
| `functions/src/billing.ts` | `createCheckoutSession` / `createBillingPortalSession` / `stripeWebhook` |
| `src/app/upgrade/page.tsx` | プラン説明・申し込み・解約 |
| `src/app/legal/tokushoho/page.tsx` | 特商法表記(**未記入の雛形**) |
| `BILLING_SETUP.md` | Stripe側の設定手順(全ステップ) |

### 設計の要点
- **`plan` はクライアントから書き換え禁止**(`firestore.rules` で `plan` を含む更新を拒否)。
  Admin SDK(= Webhook)経由でしか書けない。これがないと開発者ツールで1行書き換えるだけで有料機能が開く。
- Webhookは**生ボディで署名検証**してから信用する。ハンドラ失敗時は500を返してStripeに再送させる。
- カード情報はアプリを一切通らない(Stripe Checkout)。
- 解約導線は勧誘と同じ画面に置き、隠していない。

### 有料/無料の線引き(Kaz指示)
- **有料(プレミアム)**: おまかせ提案(自動でコーデを組む機能)のみ。
- **無料**: それ以外すべて。**AI画像生成は無料**。2択、クローゼット、投稿、SNS、DM、カレンダー。

### 勧誘方針(厳守)
**執拗な課金勧誘は絶対にしない。** 案内はロックされた項目をタップしたときの1画面だけ。
常時表示バナー、再訪の催促、期間限定を煽る表示、閉じにくいダイアログは入れない。

### 未完了
- Stripeアカウント・商品・price ID の作成
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` の登録、`functions/.env` の `STRIPE_PRICE_ID`
- **Stripe関数のデプロイ**(シークレット未登録のため未実施)
- Vercel環境変数 `NEXT_PUBLIC_BILLING_ENABLED=true`
- 特商法表記の記入

---

## 5. 実装していないもの(と理由)

| 機能 | 理由 |
|---|---|
| 指定時刻のプッシュ通知 | 設定UIのみ。実際のpushはFCM+Service Worker+Cloud Schedulerが必要で、iOS Safariの制約もあり無料枠では安定しない |
| 流行りを取り込んだレコメンド | 外部データ源が必要。代わりに季節・好みのジャンル・着ていない期間から選ぶローカル実装(`src/lib/recommend.ts`)。**外部API不使用なので費用ゼロ** |
| モデル/芸能スカウト機能 | 土台(公開プロフィール・フォロワー数・公開投稿)のみ。アカウント種別と連絡導線の設計が必要 |
| PWAオフライン対応 | Service Worker未実装。マニフェストとアイコンのみ |
| 投稿の編集 | 作成と削除のみ。ルール上は編集を許可済みなのでUIを足せば動く |
| DMでの写真送信 | Kaz指示により当面テキストのみ |

---

## 6. 開発時の実務メモ

### 環境
- **`node` / `npm` にPATHが通っていない。** 毎回これを付ける:
  ```powershell
  $env:PATH = "C:\Users\kazdr\AppData\Local\nodejs-portable\node-v24.18.1-win-x64;" + $env:PATH
  ```
- Bashツールからは `npx` が見えない。PowerShell経由で実行すること。
- コミットメッセージは Bash ツールならヒアドキュメント(`<<'EOF'`)。**PowerShellの `@'...'@` は Bash では動かない**(一度失敗した)。

### デプロイ
- Web: `git push origin master` → Vercel が自動デプロイ(約2〜3分)。
- ルール: `firebase deploy --only firestore:rules,storage`
- 関数: `firebase deploy --only functions`

### ⚠ 反映確認でVercelの防御を作動させた事故
デプロイ確認のため15秒間隔で40回ポーリングしたところ、**Vercelの自動DDoS緩和が作動して自分のIPが403になった**
(サイト全体ではなく接続元のみ。他IPからは正常だった)。30分ほどで自動解除。
**確認は数回に留めること。** ルートのHTTPステータス(404→200)か、JSバンドル内の文字列検索を1回行えば十分。

### 検証で使える手段
- Firestoreの実データはgcloudのアクセストークン+REST APIで読める(原因特定に有効だった)。
  ```powershell
  $t = gcloud auth print-access-token
  Invoke-RestMethod -Uri "https://firestore.googleapis.com/v1/projects/my-clothes-46c81/databases/(default)/documents/users?pageSize=50" -Headers @{Authorization="Bearer $t"}
  ```
- **ログイン後の画面はClaude側から操作できない。** 実機確認は必ずKazさんに依頼すること。

---

## 7. ディレクトリ構成(抜粋)

```
src/
  app/
    feed/          公開タイムライン(ホーム)
    vote/          2択の一覧と詳細(投票・着用確定)
    create/        コーデ作成(決め方2種)
    closet/        クローゼット、closet/add で登録
    post/new/      全身写真の投稿(アイテムタグ付け)
    post/[postId]/ 投稿詳細+コメント
    profile/       マイページ、profile/edit で編集(アイコン変更もここ)
    u/[uid]/       他人のプロフィール(フォロー・DM導線)
    calendar/      1ヶ月のコーデ記録
    chat/          DM一覧、chat/[threadId] で会話
    search/        ユーザー検索+ジャンル別グリッド
    upgrade/       プラン説明・申し込み・解約
    legal/tokushoho/ 特商法表記(未記入)
  components/
    ui.tsx         共通UI(ActionBar, Avatar, Chip, BottomSheet ほか)
    OutfitCard.tsx 合成画像 or 顔+服のボード表示
    HangerRail.tsx ハンガー表示
    StylePostCard.tsx 公開投稿カード(アイテムタグ表示)
    AppShell.tsx   認証ガードと下タブ
  lib/
    firestore.ts   データアクセス全般
    recommend.ts   ローカル提案ロジック(外部API不使用)
    functions.ts   Cloud Functions 呼び出し(リージョン定数に注意)
functions/src/
  index.ts         composeOutfitImage(Gemini合成)
  billing.ts       Stripe(未デプロイ)
```

---

## 8. 次のセッションで最初にやるとよいこと

1. このファイルと `BILLING_SETUP.md` を読む。
2. Kazさんに **実機での動作確認結果**を聞く(特に DM が送れるか、投稿ボタンが押せるか、AI合成の画像が出るか)。
   前セッションではClaude側から検証できていない。
3. Stripeのテストキーが用意できていれば、関数デプロイと決済テストを進める。
4. 未確認のまま残っている点があれば、推測せず実データを見て確かめる。

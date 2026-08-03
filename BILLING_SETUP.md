# 課金機能(Stripe)の設定手順

コードは実装済みです。あとは Stripe アカウント側の設定と、鍵の登録だけです。
**下記を全部終えるまで、申し込みボタンはユーザーに表示されません**(`NEXT_PUBLIC_BILLING_ENABLED` で止めてあります)。

実装済みのもの:

| 場所 | 役割 |
|---|---|
| `functions/src/billing.ts` | 決済ページ発行 / 解約ポータル / Webhook 受信 |
| `src/app/upgrade/page.tsx` | プラン説明・申し込み・解約 |
| `src/app/legal/tokushoho/page.tsx` | 特定商取引法に基づく表記(**未記入**) |
| `firestore.rules` | `plan` をクライアントから書き換え禁止 |

---

## 0. 先に決めること

**月額いくらにするか。** 個人向けのこの規模なら月額300〜500円程度が相場感ですが、決めるのはKazさんです。
下の手順ではこの金額を Stripe 側に登録します。

## 1. Stripe アカウントを作る

1. https://dashboard.stripe.com/register で登録。
2. 本番の決済を受けるには**本人確認と銀行口座の登録**が必要です(審査に数日かかることがあります)。
3. 審査が終わるまでは**テストモード**で一通り動作確認できます。まずはテストモードで進めるのがおすすめです。

## 2. 商品と料金を作る

1. Stripe ダッシュボード → **商品カタログ** → 商品を追加。
2. 名前は「My Clothes プレミアム」など。
3. 料金は **継続(サブスクリプション)/ 月次**、通貨は JPY、金額は 0. で決めた額。
4. 作成後に表示される **price ID(`price_` で始まる文字列)**を控える。

## 3. 鍵を Firebase に登録する

シークレットキーは `sk_` で始まる値です(テストモードなら `sk_test_`)。
Stripe ダッシュボード → 開発者 → APIキー から取得します。

```bash
cd C:\Users\kazdr\dev\my_clothes
firebase functions:secrets:set STRIPE_SECRET_KEY
# プロンプトが出たら sk_... を貼り付け
```

price ID とアプリのURLは秘密ではないので、`functions/.env` に書きます。

```
STRIPE_PRICE_ID=price_xxxxxxxxxxxxx
APP_BASE_URL=https://my-clothes-three.vercel.app
```

## 4. Webhook の秘密鍵を登録する

Webhook は「支払いが本当に成立したか」を確かめる唯一の経路です。ここが正しく設定されていないと、
誰かが「払いました」と偽っても有料機能は開かない代わりに、**本当に払った人も有料にならない**ので必須です。

Webhook のURLは関数をデプロイしないと決まらないため、**先に仮の値で登録 → デプロイ → 本物に差し替え**の順になります。

```bash
# 4-1. いったん仮の値を入れる(この値では検証に通らないが、デプロイは通る)
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# whsec_placeholder と入力

# 4-2. デプロイ
firebase deploy --only functions
```

デプロイ後、`stripeWebhook` のURLが表示されます。形式は次のとおりです。

```
https://us-central1-my-clothes-46c81.cloudfunctions.net/stripeWebhook
```

1. Stripe ダッシュボード → 開発者 → **Webhook** → エンドポイントを追加。
2. 上のURLを貼る。
3. 送信するイベントに次の4つを選ぶ。
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. 作成後に表示される **署名シークレット(`whsec_` で始まる)**を控える。
5. 本物の値に差し替えて再デプロイ。

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# whsec_... を貼り付け
firebase deploy --only functions
```

## 5. 解約ポータルを有効にする

Stripe ダッシュボード → 設定 → **カスタマーポータル** で有効化し、「サブスクリプションのキャンセルを許可」を
オンにします。これをしないと `createBillingPortalSession` がエラーになります。

## 6. 特定商取引法の表記を埋める(法令上必須)

`src/app/legal/tokushoho/page.tsx` の `ROWS` にある `value: null` の項目を実際の情報に置き換えてください。
氏名・所在地・連絡先・価格が必要です。**未記入のまま有料販売を始めると法令違反になります。**
現状は画面上に「この表記はまだ完成していません」と警告が出るようにしてあります。

なお、住所の掲載に抵抗がある場合、特定商取引法では「請求があったら遅滞なく開示する」旨を明記する運用が
認められるケースがありますが、条件があるので個人で判断せず、消費者庁の解説を確認してください。

## 7. 申し込みボタンを表示する

Vercel のプロジェクト設定 → Environment Variables に追加し、再デプロイします。

```
NEXT_PUBLIC_BILLING_ENABLED=true
```

## 8. テストする

テストモードのカード番号 `4242 4242 4242 4242`(有効期限は未来の日付、CVCは任意の3桁)で決済できます。

確認すること:

- 決済後、Firestore の自分の users ドキュメントの `plan` が `premium` になるか
- アプリの「おまかせ」が使えるようになるか
- 解約ポータルから解約すると `plan` が `free` に戻るか

---

## 動作のしくみ(仕組みを把握しておきたいとき)

1. ユーザーが「プレミアムに申し込む」を押す
2. `createCheckoutSession` が Stripe の決済ページURLを作って返す
   - このとき Stripe の顧客IDを作り、users ドキュメントに `stripeCustomerId` として控える
   - **カード情報はアプリを一切通らない**(Stripe がホストするページで入力される)
3. 決済が成立すると Stripe から `stripeWebhook` にイベントが飛ぶ
4. 署名を検証したうえで、Admin SDK が `plan: "premium"` を書き込む
5. 解約・支払い失敗も Webhook で届き、`plan: "free"` に戻る

**なぜクライアントから `plan` を書かないのか**: 書けるようにすると、ブラウザの開発者ツールから
自分のドキュメントを1行書き換えるだけで有料機能が使い放題になります。`firestore.rules` で
`plan` の変更を明示的に禁止してあるので、Admin SDK(= Webhook)以外からは書けません。

## 費用

- Stripe の手数料は国内カードで概ね 3.6%(最新は https://stripe.com/jp/pricing で確認)
- Cloud Functions の呼び出しは無料枠(月200万回)に十分収まる規模です
- 初期費用・月額固定費はかかりません

## 将来ネイティブアプリにする場合の注意

iOS / Android のアプリストアで配布する場合、**デジタルコンテンツの販売はApple・Googleの課金システムの
利用が原則義務**で、手数料は15〜30%です。Web(PWA)のまま配布する限りこれは適用されません。

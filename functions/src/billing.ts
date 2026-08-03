import { getFirestore } from "firebase-admin/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import Stripe from "stripe";

/**
 * Stripe による有料プラン(プレミアム)。
 *
 * 設計の要は「plan は Admin SDK からしか書かない」こと。firestore.rules 側で
 * クライアントからの plan 変更を禁止しているので、ここを通らない限り誰も
 * 有料機能を開けられない。決済が成立したという事実は Stripe の Webhook を
 * 署名検証したうえでのみ信用する(クライアントの「払いました」は信用しない)。
 */

const db = getFirestore();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

/** Stripe ダッシュボードで作った「プレミアム」料金の price ID (price_xxx)。 */
const stripePriceId = defineString("STRIPE_PRICE_ID", { default: "" });
/** 決済後に戻ってくる先。Vercel の本番URL。 */
const appBaseUrl = defineString("APP_BASE_URL", { default: "https://my-clothes-three.vercel.app" });

const FUNCTION_REGION = "us-central1";

function stripeClient(): Stripe {
  const key = stripeSecretKey.value();
  if (!key) throw new HttpsError("failed-precondition", "決済の設定が未完了です。");
  return new Stripe(key);
}

/**
 * この人の Stripe 顧客IDを取り出す。無ければ作って users ドキュメントに控える。
 * 毎回新しい顧客を作ると、同じ人の請求履歴がStripe上でばらばらになるため。
 */
async function ensureCustomer(stripe: Stripe, uid: string, email?: string): Promise<string> {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const existing = snap.get("stripeCustomerId") as string | undefined;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email,
    metadata: { firebaseUid: uid },
  });
  await ref.update({ stripeCustomerId: customer.id });
  return customer.id;
}

// ---------------------------------------------------------------------------
// 決済ページのURLを作る
// ---------------------------------------------------------------------------

export const createCheckoutSession = onCall(
  { region: FUNCTION_REGION, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    const priceId = stripePriceId.value();
    if (!priceId) throw new HttpsError("failed-precondition", "料金プランが未設定です。");

    const stripe = stripeClient();
    const customerId = await ensureCustomer(stripe, uid, request.auth?.token.email);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // uid を持ち回して、Webhook 側でどのユーザーの支払いか判別できるようにする。
      client_reference_id: uid,
      subscription_data: { metadata: { firebaseUid: uid } },
      success_url: `${appBaseUrl.value()}/upgrade?result=success`,
      cancel_url: `${appBaseUrl.value()}/upgrade?result=cancelled`,
      allow_promotion_codes: true,
locale: "ja",
    });

    if (!session.url) throw new HttpsError("internal", "決済ページを作成できませんでした。");
    return { url: session.url };
  }
);

// ---------------------------------------------------------------------------
// 解約・支払い方法の変更(Stripe のカスタマーポータルに丸投げする)
// ---------------------------------------------------------------------------

export const createBillingPortalSession = onCall(
  { region: FUNCTION_REGION, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "サインインが必要です。");

    const stripe = stripeClient();
    const snap = await db.collection("users").doc(uid).get();
    const customerId = snap.get("stripeCustomerId") as string | undefined;
    if (!customerId) throw new HttpsError("failed-precondition", "お申し込み履歴が見つかりません。");

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl.value()}/upgrade`,
    });
    return { url: session.url };
  }
);

// ---------------------------------------------------------------------------
// Webhook: 支払い状態の変化を受けて plan を書き換える
// ---------------------------------------------------------------------------

async function setPlanForCustomer(customerId: string, plan: "free" | "premium"): Promise<void> {
  const found = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
  if (found.empty) return;
  await found.docs[0].ref.update({ plan });
}

/** 契約が「使える状態」か。支払い遅延などは有効扱いにしない。 */
function isActive(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "trialing";
}

export const stripeWebhook = onRequest(
  { region: FUNCTION_REGION, secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).send("missing signature");
      return;
    }

    let event: Stripe.Event;
    try {
      // 署名検証には整形前の生ボディが要る。req.body ではパース済みで検証が通らない。
      event = stripeClient().webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret.value());
    } catch (err) {
      // 検証に失敗したリクエストは Stripe から来たと信用できないので、何もせず落とす。
      res.status(400).send(`signature verification failed: ${err instanceof Error ? err.message : "unknown"}`);
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const uid = session.client_reference_id;
          const customerId = typeof session.customer === "string" ? session.customer : null;
          if (uid) {
            await db.collection("users").doc(uid).update({
              plan: "premium",
              ...(customerId ? { stripeCustomerId: customerId } : {}),
            });
          } else if (customerId) {
            await setPlanForCustomer(customerId, "premium");
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          const customerId =
            typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
          const active = event.type !== "customer.subscription.deleted" && isActive(subscription.status);
          await setPlanForCustomer(customerId, active ? "premium" : "free");
          break;
        }

        default:
          // 関心のないイベントは 200 を返して受理しておく。再送され続けるのを避けるため。
          break;
      }
      res.status(200).send("ok");
    } catch (err) {
      // ここで 500 を返すと Stripe が再送してくれる。取りこぼしを防ぐためあえて失敗させる。
      console.error("stripe webhook handling failed", err);
      res.status(500).send("handler error");
    }
  }
);

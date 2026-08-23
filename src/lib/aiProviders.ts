/**
 * AI合成に使えるサービスの一覧と、キーの取り方。
 *
 * 画面(オンボーディングとプロフィール編集)とサーバー(functions/src/index.ts)の
 * 両方が同じ判別規則を使う必要があるので、規則はここ1か所に置いてある。
 * **提供元を利用者に選ばせない。** キーを取ってきた本人にとって、どこで取ったかは
 * 自明なので、選択肢を出しても手間が増えるだけ。貼られた文字列の形で機械的に決める。
 */

export type AiProvider = "google" | "openai";

export interface AiProviderInfo {
  value: AiProvider;
  /** 画面に出す名前 */
  label: string;
  /** このサービスのキーの見分け方(利用者にも見せる) */
  keyPrefix: string;
  /** キーを発行するページ */
  consoleUrl: string;
  /** 取得の手順。上から順にそのままやれば終わるように書くこと。 */
  steps: string[];
  /** お金の話。曖昧にせず、無料枠の有無をはっきり書く。 */
  cost: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    value: "google",
    label: "Google AI Studio",
    keyPrefix: "AIza",
    consoleUrl: "https://aistudio.google.com/apikey",
    steps: [
      "上のリンクを開いて、ふだん使っている Google アカウントでログインします。",
      "「Create API key」(APIキーを作成)を押します。",
      "プロジェクトを選ぶ画面が出たら、表示されているものをそのまま選んで大丈夫です。",
      "「AIza」で始まる文字列が出るのでコピーします。この画面を閉じると二度と表示されないので、必ずここでコピーしてください。",
      "下の欄に貼り付けて「保存して確認する」を押します。",
    ],
    cost: "画像生成に無料枠はありません。Google Cloud 側で支払い方法の登録が必要です。目安は1枚あたり十数円で、2択を1回作ると2枚生成します。",
  },
  {
    value: "openai",
    label: "OpenAI",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.openai.com/api-keys",
    steps: [
      "上のリンクを開いて、OpenAI のアカウントでログインします。",
      "「Create new secret key」を押します。",
      "名前は何でも構いません(例: My Clothes)。",
      "「sk-」で始まる文字列が出るのでコピーします。この画面を閉じると二度と表示されないので、必ずここでコピーしてください。",
      "下の欄に貼り付けて「保存して確認する」を押します。",
    ],
    cost: "あらかじめ Billing の画面でクレジットを購入しておく必要があります。残高が0だと生成に失敗します。",
  },
];

export function providerInfo(provider: AiProvider): AiProviderInfo {
  // 一覧に必ず存在するので、見つからない場合は先頭(Google)に倒す。
  return AI_PROVIDERS.find((p) => p.value === provider) ?? AI_PROVIDERS[0];
}

/**
 * 貼られたキーがどのサービスのものかを見分ける。
 * **functions/src/index.ts の detectProvider と同じ規則にすること。**
 * 片方だけ変えると、画面では受け付けたのにサーバーで別扱いになる。
 */
export function detectAiProvider(apiKey: string): AiProvider | null {
  const key = apiKey.trim();
  // ⚠ Claude のキーは "sk-ant-" で始まる。OpenAI の "sk-" が前方一致で先に当たるので、
  //   ここで先に弾かないと、Claudeのキーを画像生成欄に貼った人が OpenAI 扱いになり、
  //   毎回わけの分からない認証エラーで合成が失敗する。
  if (key.startsWith(STYLIST_PROVIDER.keyPrefix)) return null;
  for (const p of AI_PROVIDERS) {
    if (key.startsWith(p.keyPrefix)) return p.value;
  }
  return null;
}

/** 画像生成用の欄に Claude のキーが貼られたか。案内の文言を変えるために使う。 */
export function looksLikeStylistKey(apiKey: string): boolean {
  return apiKey.trim().startsWith(STYLIST_PROVIDER.keyPrefix);
}

/**
 * コーデを考える役(Anthropic / Claude)。
 *
 * **画像は作れない。** Claude は画像を読めるが生成・編集はできないので、AI合成の
 * 提供元一覧(AI_PROVIDERS)には入れない。役割が違うので保存先のフィールドも別。
 */
export const STYLIST_PROVIDER = {
  label: "Anthropic (Claude)",
  keyPrefix: "sk-ant-",
  consoleUrl: "https://console.anthropic.com/settings/keys",
  steps: [
    "上のリンクを開いて、Anthropic のアカウントでログインします。",
    "「Create Key」を押します。名前は何でも構いません(例: My Clothes)。",
    "「sk-ant-」で始まる文字列が出るのでコピーします。この画面を閉じると二度と表示されません。",
    "下の欄に貼り付けて保存します。",
  ],
  cost: "あらかじめ Billing でクレジットを購入しておく必要があります。目安は1回の提案で10円前後(手持ちの服が多いほど少し上がります)。",
};

/** 画面に出す用の伏せ字。先頭4文字と末尾4文字だけ残す。 */
export function maskApiKey(key: string): string {
  if (key.length <= 10) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

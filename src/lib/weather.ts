/**
 * 今日の天気を取って、服選びの助言に変える。
 *
 * 「朝の服選びを速くする」のが主目的なので、気温と雨の有無が分かれば十分。
 * 外部サービスは **APIキーの要らないもの**だけを使う。鍵を持つとクライアントに
 * 置けず、Cloud Functions を経由する必要が出て、無料枠と応答速度を圧迫するため。
 *   - 天気: Open-Meteo (https://open-meteo.com)
 *   - 逆ジオコーディング: BigDataCloud
 *
 * 位置情報は**必ず本人の操作で許可されてから**取りに行く。勝手に取らない。
 * さらに、送る座標は小数第1位に丸めている(約11km四方)。天気の判定にはそれで
 * 足り、生活圏がピンポイントで外部に出るのを避けたいため。
 */

export interface TodayWeather {
  /** 最高気温(℃)。 */
  maxTemp: number;
  /** 最低気温(℃)。 */
  minTemp: number;
  /** 降水確率(%)。 */
  rainChance: number;
  /** 天気コード(Open-Meteo の WMO コード)。 */
  code: number;
  /** 市区町村レベルの地名。取れなければ null。 */
  placeName: string | null;
  /** 取得時刻。日付が変わったら取り直す判定に使う。 */
  fetchedAt: number;
}

const CACHE_KEY = "my-clothes.weather.v1";
const OPT_IN_KEY = "my-clothes.weather.optIn";

/** 位置情報の利用に同意済みか。同意は端末ごとに覚える。 */
export function hasWeatherOptIn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPT_IN_KEY) === "true";
}

export function setWeatherOptIn(value: boolean): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(OPT_IN_KEY, "true");
  else {
    window.localStorage.removeItem(OPT_IN_KEY);
    window.localStorage.removeItem(CACHE_KEY);
  }
}

function readCache(): TodayWeather | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as TodayWeather;
    // 日付が変わっていたら捨てる。朝いちばんに古い天気を見せないため。
    const sameDay = new Date(cached.fetchedAt).toDateString() === new Date().toDateString();
    return sameDay ? cached : null;
  } catch {
    return null;
  }
}

function writeCache(weather: TodayWeather): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(weather));
  } catch {
    // 保存できなくても致命的ではない。次回また取りに行くだけ。
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("この端末では位置情報が使えません。"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      // 天気は町単位で足りるので、精度より速さを優先する。
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 30 * 60 * 1000,
    });
  });
}

/** 座標を約11km四方に丸める。生活圏をピンポイントで外部に渡さないため。 */
function coarse(value: number): number {
  return Math.round(value * 10) / 10;
}

async function fetchPlaceName(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string };
    return json.city || json.locality || json.principalSubdivision || null;
  } catch {
    // 地名は「あると嬉しい」程度の情報。取れなくても天気は出す。
    return null;
  }
}

/**
 * 今日の天気を取得する。同意していなければ何もしないで null を返す。
 * `force` を付けると、その場で許可ダイアログを出して取りに行く。
 */
export async function loadTodayWeather(force = false): Promise<TodayWeather | null> {
  if (!force && !hasWeatherOptIn()) return null;

  const cached = readCache();
  if (cached && !force) return cached;

  const pos = await getPosition();
  const lat = coarse(pos.coords.latitude);
  const lon = coarse(pos.coords.longitude);

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=auto&forecast_days=1"
  );
  if (!res.ok) throw new Error("天気の取得に失敗しました。");
  const json = (await res.json()) as {
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: (number | null)[];
    };
  };

  const d = json.daily;
  if (!d?.temperature_2m_max?.length) throw new Error("天気の取得に失敗しました。");

  const weather: TodayWeather = {
    maxTemp: Math.round(d.temperature_2m_max[0]),
    minTemp: Math.round(d.temperature_2m_min?.[0] ?? d.temperature_2m_max[0]),
    rainChance: Math.round(d.precipitation_probability_max?.[0] ?? 0),
    code: d.weather_code?.[0] ?? 0,
    placeName: await fetchPlaceName(lat, lon),
    fetchedAt: Date.now(),
  };

  setWeatherOptIn(true);
  writeCache(weather);
  return weather;
}

/**
 * 今いる場所の地名だけを取る(投稿に付ける用)。
 *
 * 天気の同意とは別物として扱う。地名は投稿に載って**他人から見える**情報なので、
 * 「天気を見るために許可した」ことを、そのまま公開の同意に流用してはいけない。
 * 保存するのも市区町村までで、座標は残さない。
 */
export async function getCurrentPlaceName(): Promise<string | null> {
  const pos = await getPosition();
  return fetchPlaceName(coarse(pos.coords.latitude), coarse(pos.coords.longitude));
}

/** WMO の天気コードを、ひとことの日本語と絵文字にする。 */
export function describeWeather(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: "快晴", emoji: "☀️" };
  if (code <= 2) return { label: "晴れ", emoji: "🌤️" };
  if (code === 3) return { label: "くもり", emoji: "☁️" };
  if (code <= 48) return { label: "霧", emoji: "🌫️" };
  if (code <= 57) return { label: "霧雨", emoji: "🌦️" };
  if (code <= 67) return { label: "雨", emoji: "🌧️" };
  if (code <= 77) return { label: "雪", emoji: "🌨️" };
  if (code <= 82) return { label: "にわか雨", emoji: "🌦️" };
  if (code <= 86) return { label: "にわか雪", emoji: "🌨️" };
  return { label: "雷雨", emoji: "⛈️" };
}

/**
 * 気温の帯。服の重さを決めるのに使う。
 * 境目は日本の体感でよく使われる目安に合わせている。
 */
export type TempBand = "hot" | "warm" | "mild" | "cool" | "cold";

export function tempBandOf(maxTemp: number): TempBand {
  if (maxTemp >= 28) return "hot";
  if (maxTemp >= 23) return "warm";
  if (maxTemp >= 18) return "mild";
  if (maxTemp >= 12) return "cool";
  return "cold";
}

const BAND_ADVICE: Record<TempBand, string> = {
  hot: "半袖1枚で十分。日差し対策があると安心です。",
  warm: "半袖か薄手の長袖がちょうどいい日です。",
  mild: "長袖1枚、朝晩は羽織りものがあると安心です。",
  cool: "羽織りものは必須。中は長袖にしましょう。",
  cold: "しっかりしたアウターを。重ね着で調整を。",
};

/** その日の服選びへの助言。1〜2文に収める(朝に読ませるため)。 */
export function weatherAdvice(weather: TodayWeather): string {
  const base = BAND_ADVICE[tempBandOf(weather.maxTemp)];
  const spread = weather.maxTemp - weather.minTemp;
  const parts = [base];
  if (weather.rainChance >= 50) parts.push("雨が降りそうなので、濡れて困る服と靴は避けてください。");
  else if (weather.rainChance >= 30) parts.push("にわか雨に注意。");
  if (spread >= 10) parts.push("朝晩の寒暖差が大きいです。");
  return parts.join("");
}

/** アウターを勧めるべき気温か。提案ロジックの重みづけに使う。 */
export function wantsOuterwear(maxTemp: number): boolean {
  return tempBandOf(maxTemp) === "cool" || tempBandOf(maxTemp) === "cold";
}

/** 半袖で十分な気温か。 */
export function wantsLightTops(maxTemp: number): boolean {
  return tempBandOf(maxTemp) === "hot";
}

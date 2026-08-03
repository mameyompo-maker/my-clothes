"use client";

import { useEffect, useState } from "react";
import {
  describeWeather,
  hasWeatherOptIn,
  loadTodayWeather,
  setWeatherOptIn,
  weatherAdvice,
  type TodayWeather,
} from "@/lib/weather";

/**
 * 今日の天気と、それに沿った服選びの助言。
 *
 * 位置情報は**本人が押したときにだけ**取りに行く。勝手に取ると気味が悪いし、
 * 許可ダイアログが唐突に出る体験も避けたいため、まず用途を書いた誘いを出す。
 * 一度許可すれば端末に覚えるので、次からは黙って出る。
 */
export function WeatherBar({ compact = false }: { compact?: boolean }) {
  const [weather, setWeather] = useState<TodayWeather | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "denied">("idle");

  useEffect(() => {
    // 許可済みの人にだけ、黙って読み込む。
    // ここで同期的に setState すると余計な再描画が連鎖するので、結果が出てから触る。
    if (!hasWeatherOptIn()) return;
    let cancelled = false;
    void loadTodayWeather()
      .then((w) => {
        if (!cancelled) setWeather(w);
      })
      .catch(() => {
        if (!cancelled) setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setState("loading");
    try {
      const w = await loadTodayWeather(true);
      setWeather(w);
      setState("idle");
    } catch {
      // 位置情報を拒否された場合。責めずに、静かに引き下がる。
      setState("denied");
      setWeatherOptIn(false);
    }
  }

  if (weather) {
    const { label, emoji } = describeWeather(weather.code);
    return (
      <div className="rounded-3xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none" aria-hidden>
            {emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {weather.placeName ? `${weather.placeName}は` : "今日は"}
              {label}・{weather.maxTemp}℃
              <span className="ml-1 text-[11px] font-medium text-muted-foreground">
                / 最低{weather.minTemp}℃・降水{weather.rainChance}%
              </span>
            </p>
            {!compact && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {weatherAdvice(weather)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    // 拒否した人に何度も出すと嫌がられるので、案内は最小限にして終わり。
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleEnable}
      disabled={state === "loading"}
      className="tappable w-full rounded-3xl border border-dashed border-border bg-surface p-4 text-left disabled:opacity-60"
    >
      <p className="text-sm font-bold">今日の天気に合わせて選ぶ</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {state === "loading"
          ? "天気を調べています…"
          : "位置情報から気温と雨を調べて、服選びの目安を出します。市区町村より細かい場所は送りません。"}
      </p>
    </button>
  );
}

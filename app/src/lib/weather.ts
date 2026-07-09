/**
 * weather.ts — pure helpers for the plan-surface weather overlay (Slice 4).
 *
 * The forecast itself is fetched with the shared @sprigly/weather Open-Meteo client
 * (same one the weekly session uses) in the /api/plan/weather route — there is no
 * second weather path. This module only turns a raw WMO weather code into the compact
 * icon bucket + human label the calendar renders, so it's safe to import on the client
 * and in tests (no network, no Node deps).
 *
 * The overlay is pure decoration: a missing forecast, a fetch failure, or a client
 * with no lat/lon renders the calendar identically (see usePlanData + the route).
 */

/** The 8 compact icons the calendar draws. Open-Meteo's ~28 WMO codes bucket into these. */
export type WeatherIcon =
  | 'sun' | 'partly-cloudy' | 'overcast' | 'fog'
  | 'rain' | 'heavy-rain' | 'snow' | 'thunder';

/** One forecast day as the plan surface consumes it (°C only). */
export interface WeatherDay {
  date: string;        // 'YYYY-MM-DD'
  weatherCode: number; // raw WMO interpretation code
  tempMaxC: number;    // daily max, °C
}

/** The wire shape returned by GET /api/plan/weather ([{date, weather_code, temp_max_c}]). */
export interface WeatherWireDay {
  date: string;
  weather_code: number;
  temp_max_c: number;
}

/**
 * Bucket a WMO weather-interpretation code into one of the 8 icons. Open-Meteo's
 * long tail (freezing drizzle, snow grains, shower variants, hail thunder) is folded
 * into the nearest sensible bucket rather than given its own glyph. Reference:
 * https://open-meteo.com/en/docs (WW codes).
 *
 * Clear/haze care (UAT §22): code 1 ("mainly clear") is a SUN, not a cloud — a hazy-hot
 * day that Open-Meteo reports as 1 must not read as "cloudy". Only 2 ("partly cloudy")
 * and 3 ("overcast") earn cloud glyphs. So 0 and 1 → sun, 2 → partly-cloudy, 3 → overcast.
 */
export function bucketWeatherIcon(code: number): WeatherIcon {
  if (code === 0 || code === 1) return 'sun';                    // clear / mainly clear (haze) → sun
  if (code === 2) return 'partly-cloudy';                        // partly cloudy
  if (code === 3) return 'overcast';                             // overcast
  if (code === 45 || code === 48) return 'fog';                  // fog / depositing rime fog
  if (code >= 95) return 'thunder';                              // 95, 96, 99 thunderstorm (+hail)
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'; // snow fall / grains / showers
  // Heavy end of the rain family gets the heavier glyph; everything else is rain.
  if (code === 65 || code === 67 || code === 82) return 'heavy-rain'; // heavy rain / heavy freezing rain / violent showers
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 81)) return 'rain'; // drizzle, rain, freezing rain, showers
  return 'overcast'; // unknown/unmapped → the most neutral non-alarming glyph
}

/**
 * Temperature "tone" for the cell label (UAT §22). During a heatwave an icon-only cell
 * can't communicate heat, so the temp label is emphasised by band:
 *  · 'scorcher' (≥32°) — amber label AND, when the day is sunny, a "hot-sun" icon variant.
 *  · 'hot'      (≥27°) — amber label, normal icon.
 *  · 'cold'     (≤2°)  — a calm slate-blue label (cold extreme).
 *  · 'normal'          — the muted default.
 * Kept quiet: an accent for scannability, never an alert. Thresholds are °C.
 */
export type TempTone = 'scorcher' | 'hot' | 'cold' | 'normal';
export const HOT_C = 27;
export const SCORCHER_C = 32;
export const COLD_C = 2;
export function tempTone(tempMaxC: number): TempTone {
  if (tempMaxC >= SCORCHER_C) return 'scorcher';
  if (tempMaxC >= HOT_C) return 'hot';
  if (tempMaxC <= COLD_C) return 'cold';
  return 'normal';
}

/** Short, calm condition labels (used in the tooltip / accessible label). */
export const WEATHER_LABEL: Record<WeatherIcon, string> = {
  sun: 'clear',
  'partly-cloudy': 'partly cloudy',
  overcast: 'overcast',
  fog: 'fog',
  rain: 'rain',
  'heavy-rain': 'heavy rain',
  snow: 'snow',
  thunder: 'thunderstorm',
};

/** "18° · rain" — the desktop tooltip and the mobile accessible label share this. */
export function weatherTooltip(day: WeatherDay): string {
  return `${Math.round(day.tempMaxC)}° · ${WEATHER_LABEL[bucketWeatherIcon(day.weatherCode)]}`;
}

/** Fold the wire array into a date→day map for O(1) per-cell lookup. */
export function indexForecast(days: WeatherWireDay[]): Map<string, WeatherDay> {
  const m = new Map<string, WeatherDay>();
  for (const d of days) {
    if (d && typeof d.date === 'string') {
      m.set(d.date, { date: d.date, weatherCode: Number(d.weather_code) || 0, tempMaxC: Number(d.temp_max_c) || 0 });
    }
  }
  return m;
}

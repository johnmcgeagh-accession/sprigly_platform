/**
 * @sprigly/weather — Open-Meteo daily forecast client (no API key).
 *
 * Fetches a 7-day daily forecast by lat/lon and maps WMO weather codes to a small
 * category enum. Used by the weekly planning session's weather audit. Threshold
 * classification (notable heat/cold/rain) lives in the CONSUMER (the weekly
 * session), not here — this package only fetches and normalises.
 *
 * Cache: in-memory, per (lat,lon) per London-day, 6h TTL. This is a per-PROCESS
 * cache — ideal for the long-running engine worker (one fetch per weekly run).
 * A serverless caller would refetch, which is fine (the API is free/unmetered).
 */

export type WeatherCategory =
  | 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' | 'unknown';

export interface DailyForecast {
  date: string;                 // 'YYYY-MM-DD'
  tempMax: number;              // °C
  tempMin: number;              // °C
  precipProbability: number;    // 0–100 (%)
  code: number;                 // raw WMO weathercode
  category: WeatherCategory;
}

/** Map a WMO weather interpretation code to a coarse category.
 *  Reference: https://open-meteo.com/en/docs (WW codes). */
export function categorizeWeatherCode(code: number): WeatherCategory {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'unknown';
}

interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  weathercode?: number[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseForecast(daily: OpenMeteoDaily): DailyForecast[] {
  const days = daily.time ?? [];
  return days.map((date, i) => {
    const code = num(daily.weathercode?.[i]);
    return {
      date,
      tempMax: num(daily.temperature_2m_max?.[i]),
      tempMin: num(daily.temperature_2m_min?.[i]),
      precipProbability: num(daily.precipitation_probability_max?.[i]),
      code,
      category: categorizeWeatherCode(code),
    };
  });
}

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// ── per-process cache ─────────────────────────────────────────────────────────
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cache = new Map<string, { at: number; data: DailyForecast[] }>();

/** London calendar day, so the cache key rolls over at London midnight. */
function londonDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface FetchForecastOptions {
  fetchImpl?: typeof fetch;   // injectable for tests
  now?: Date;
  forecastDays?: number;
}

/**
 * Fetch the next `forecastDays` (default 7) daily forecast for a location.
 * Cached per (lat,lon) per London-day. Returns [] on any network/parse failure —
 * the caller (weekly session) degrades to no weather findings.
 */
export async function fetchForecast(lat: number, lon: number, opts: FetchForecastOptions = {}): Promise<DailyForecast[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const days = opts.forecastDays ?? 7;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}:${londonDay(now)}:${days}`;

  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.data;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode',
    forecast_days: String(days),
    timezone: 'Europe/London',
  });

  try {
    const res = await fetchImpl(`${OPEN_METEO}?${params.toString()}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { daily?: OpenMeteoDaily };
    const data = body.daily ? parseForecast(body.daily) : [];
    cache.set(key, { at: now.getTime(), data });
    return data;
  } catch {
    return [];
  }
}

/** Clear the in-memory cache (tests). */
export function _clearForecastCache(): void {
  cache.clear();
}

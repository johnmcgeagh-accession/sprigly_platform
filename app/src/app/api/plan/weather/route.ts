/**
 * GET /api/plan/weather — the daily forecast for the plan surface's calendar overlay
 * (Slice 4). Returns { forecast: [{date, weather_code, temp_max_c}] } for today + 14
 * days, °C only, scoped to the session's client (its lat/lon).
 *
 * Reuses the SAME Open-Meteo client the weekly session uses (@sprigly/weather
 * fetchForecast) — no second weather path — which carries its own per-process
 * (lat,lon,London-day) 6h cache, so this is effectively cached per client for a few
 * hours. Pure decoration: no lat/lon, a fetch failure, or any error returns an empty
 * forecast so the calendar renders identically and nothing is ever surfaced. Kept off
 * the plan payload so a slow/failing Open-Meteo can never block or delay plan render —
 * the client fetches this in parallel and ignores failures.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, clients } from '@sprigly/db';
import { fetchForecastWithMeta } from '@sprigly/weather';
import { getSession } from '@/lib/auth';
import { e2eFakeEnabled, e2eTodayIso, e2eWeatherForecast } from '@/lib/e2e-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORECAST_DAYS = 15; // today + 14

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // Deterministic stub for the e2e harness — no Open-Meteo call.
  if (e2eFakeEnabled()) {
    return NextResponse.json({ forecast: e2eWeatherForecast(e2eTodayIso() ?? '2026-07-08'), fetchedAt: new Date().toISOString() });
  }

  try {
    const [client] = await db
      .select({ lat: clients.lat, lon: clients.lon })
      .from(clients)
      .where(eq(clients.id, session.clientId))
      .limit(1);
    // No location on file → no weather. The calendar renders exactly as without it.
    if (!client || client.lat == null || client.lon == null) {
      return NextResponse.json({ forecast: [] });
    }
    // fetchedAt/fromCache come straight from the package cache, so staleness is
    // diagnosable: on a cache hit fetchedAt is the ORIGINAL Open-Meteo fetch time (up to
    // the 6h TTL old). Exposed in the payload + a header for the network tab.
    const { data, fetchedAt, fromCache } = await fetchForecastWithMeta(client.lat, client.lon, { forecastDays: FORECAST_DAYS });
    const forecast = data.map((d) => ({ date: d.date, weather_code: d.code, temp_max_c: d.tempMax }));
    return NextResponse.json(
      { forecast, fetchedAt: new Date(fetchedAt).toISOString(), cached: fromCache },
      { headers: { 'x-weather-fetched-at': new Date(fetchedAt).toISOString() } },
    );
  } catch {
    // Pure decoration — never let a weather failure surface anything to the client.
    return NextResponse.json({ forecast: [] });
  }
}

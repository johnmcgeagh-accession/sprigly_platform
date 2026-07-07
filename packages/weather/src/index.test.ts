import { describe, it, expect, beforeEach } from 'vitest';
import { categorizeWeatherCode, fetchForecast, _clearForecastCache, type DailyForecast } from './index.js';

describe('categorizeWeatherCode', () => {
  const cases: Array<[number, string]> = [
    [0, 'clear'], [1, 'cloudy'], [3, 'cloudy'], [45, 'fog'], [48, 'fog'],
    [53, 'drizzle'], [63, 'rain'], [81, 'rain'], [71, 'snow'], [86, 'snow'],
    [95, 'storm'], [99, 'storm'], [1234, 'unknown'],
  ];
  it.each(cases)('code %i → %s', (code, cat) => {
    expect(categorizeWeatherCode(code)).toBe(cat);
  });
});

describe('fetchForecast', () => {
  const body = {
    daily: {
      time: ['2026-07-13', '2026-07-14'],
      temperature_2m_max: [29, 18],
      temperature_2m_min: [17, 11],
      precipitation_probability_max: [10, 80],
      weathercode: [0, 61],
    },
  };
  beforeEach(() => _clearForecastCache());

  it('maps the Open-Meteo daily block into DailyForecast[]', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => body }) as unknown as Response;
    const days = await fetchForecast(51.5, -0.12, { fetchImpl, now: new Date('2026-07-13T09:00:00Z') });
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject<Partial<DailyForecast>>({ date: '2026-07-13', tempMax: 29, precipProbability: 10, category: 'clear' });
    expect(days[1]!.category).toBe('rain');
  });

  it('caches within the TTL (one fetch for repeat calls same day)', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => body } as unknown as Response; };
    const now = new Date('2026-07-13T09:00:00Z');
    await fetchForecast(51.5, -0.12, { fetchImpl, now });
    await fetchForecast(51.5, -0.12, { fetchImpl, now });
    expect(calls).toBe(1);
  });

  it('returns [] on a network error (caller degrades to no weather)', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    expect(await fetchForecast(51.5, -0.12, { fetchImpl })).toEqual([]);
  });

  it('returns [] on a non-ok response', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) }) as unknown as Response;
    expect(await fetchForecast(51.5, -0.12, { fetchImpl, now: new Date('2026-07-14T09:00:00Z') })).toEqual([]);
  });
});

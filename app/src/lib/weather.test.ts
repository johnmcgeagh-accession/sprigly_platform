import { describe, it, expect } from 'vitest';
import { bucketWeatherIcon, weatherTooltip, indexForecast, WEATHER_LABEL } from './weather';

describe('bucketWeatherIcon', () => {
  it('maps each WMO band to the intended icon', () => {
    expect(bucketWeatherIcon(0)).toBe('sun');
    expect(bucketWeatherIcon(1)).toBe('partly-cloudy');
    expect(bucketWeatherIcon(2)).toBe('partly-cloudy');
    expect(bucketWeatherIcon(3)).toBe('overcast');
    expect(bucketWeatherIcon(45)).toBe('fog');
    expect(bucketWeatherIcon(48)).toBe('fog');
    // drizzle + light/moderate rain + rain showers → rain
    expect(bucketWeatherIcon(51)).toBe('rain');
    expect(bucketWeatherIcon(61)).toBe('rain');
    expect(bucketWeatherIcon(63)).toBe('rain');
    expect(bucketWeatherIcon(66)).toBe('rain');
    expect(bucketWeatherIcon(80)).toBe('rain');
    expect(bucketWeatherIcon(81)).toBe('rain');
    // heavy end → heavy-rain
    expect(bucketWeatherIcon(65)).toBe('heavy-rain');
    expect(bucketWeatherIcon(67)).toBe('heavy-rain');
    expect(bucketWeatherIcon(82)).toBe('heavy-rain');
    // snow family
    expect(bucketWeatherIcon(71)).toBe('snow');
    expect(bucketWeatherIcon(75)).toBe('snow');
    expect(bucketWeatherIcon(77)).toBe('snow');
    expect(bucketWeatherIcon(85)).toBe('snow');
    expect(bucketWeatherIcon(86)).toBe('snow');
    // thunder
    expect(bucketWeatherIcon(95)).toBe('thunder');
    expect(bucketWeatherIcon(96)).toBe('thunder');
    expect(bucketWeatherIcon(99)).toBe('thunder');
    // unmapped long-tail → neutral overcast
    expect(bucketWeatherIcon(4)).toBe('overcast');
    expect(bucketWeatherIcon(-1)).toBe('overcast');
  });

  it('every icon has a label', () => {
    for (const code of [0, 1, 3, 45, 51, 65, 71, 95, 999]) {
      expect(WEATHER_LABEL[bucketWeatherIcon(code)]).toBeTruthy();
    }
  });
});

describe('weatherTooltip', () => {
  it('formats "<rounded temp>° · <label>"', () => {
    expect(weatherTooltip({ date: '2026-07-08', weatherCode: 61, tempMaxC: 17.6 })).toBe('18° · rain');
    expect(weatherTooltip({ date: '2026-07-08', weatherCode: 0, tempMaxC: 24.2 })).toBe('24° · clear');
  });
});

describe('indexForecast', () => {
  it('folds the wire array into a date→day map, coercing numbers', () => {
    const m = indexForecast([
      { date: '2026-07-08', weather_code: 0, temp_max_c: 24 },
      { date: '2026-07-09', weather_code: 61, temp_max_c: 17 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get('2026-07-08')).toEqual({ date: '2026-07-08', weatherCode: 0, tempMaxC: 24 });
    expect(m.get('2026-07-09')?.weatherCode).toBe(61);
    expect(m.has('2026-07-10')).toBe(false);
  });
});

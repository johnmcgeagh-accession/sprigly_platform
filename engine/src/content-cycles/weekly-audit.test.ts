/**
 * weekly-audit.test.ts — Pass 1 logic: weather flags, the audit (with a fake
 * model), the code caps, and the summary messages.
 */
import { describe, it, expect } from 'vitest';
import type { ModelClient } from '@sprigly/model-client';
import type { DailyForecast } from '@sprigly/weather';
import {
  buildWeatherFlags, runAudit, applyCaps, quietMessage, changeMessage, fmtWeekOf,
  type AuditInput, type Finding,
} from './weekly-audit.js';

const day = (over: Partial<DailyForecast>): DailyForecast => ({
  date: '2026-07-13', tempMax: 20, tempMin: 12, precipProbability: 10, code: 1, category: 'cloudy', ...over,
});

function fakeModel(content: string): ModelClient {
  return {
    async complete() { return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
    async completeStreaming() { return { content, inputTokens: 0, outputTokens: 0, modelId: 'haiku', stopReason: 'end_turn' }; },
  };
}

const baseInput = (over: Partial<AuditInput>): AuditInput => ({
  weekStart: '2026-07-13', weekEnd: '2026-07-19', posts: [], notes: [], cycleDates: [],
  flags: buildWeatherFlags([day({})]), ...over,
});

describe('buildWeatherFlags (thresholds in code)', () => {
  it('an unremarkable week sets no notable flags', () => {
    const f = buildWeatherFlags([day({ tempMax: 20 }), day({ date: '2026-07-14', tempMax: 22 })]);
    expect(f.any).toBe(false);
  });
  it('>=27°C max flags notable heat', () => {
    expect(buildWeatherFlags([day({ tempMax: 30, category: 'clear', code: 0 })]).notableHeat).toBe(true);
  });
  it('>=70% precip flags heavy rain; storm/snow codes flag their category', () => {
    expect(buildWeatherFlags([day({ precipProbability: 80 })]).heavyRain).toBe(true);
    expect(buildWeatherFlags([day({ category: 'storm' })]).storm).toBe(true);
    expect(buildWeatherFlags([day({ category: 'snow' })]).snow).toBe(true);
  });
});

describe('runAudit', () => {
  it('an unremarkable week with no notes produces ZERO findings', async () => {
    const input = baseInput({ flags: buildWeatherFlags([day({ tempMax: 20 })]) });
    const findings = await runAudit(input, fakeModel(JSON.stringify({ findings: [] })));
    expect(findings).toHaveLength(0);
  });

  it('drops a weather_opportunity when no notable flag is set (code guard)', async () => {
    const input = baseInput({ flags: buildWeatherFlags([day({ tempMax: 20 })]) });
    const findings = await runAudit(input, fakeModel(JSON.stringify({ findings: [{ type: 'weather_opportunity', severity: 'suggest', trigger: 'sunny' }] })));
    expect(findings).toHaveLength(0);
  });

  it('a notable-heat week keeps a weather_opportunity finding', async () => {
    const input = baseInput({ flags: buildWeatherFlags([day({ tempMax: 30, category: 'clear', code: 0 })]) });
    const findings = await runAudit(input, fakeModel(JSON.stringify({ findings: [{ type: 'weather_opportunity', severity: 'suggest', trigger: '30°C on 13 Jul — post a heatwave edit' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('weather_opportunity');
  });

  it('drops a note_integration citing a note not in the input', async () => {
    const input = baseInput({ posts: [{ id: 'p1', date: '2026-07-14', channel: 'instagram', text: 'x' }], notes: [] });
    const findings = await runAudit(input, fakeModel(JSON.stringify({ findings: [{ type: 'note_integration', severity: 'suggest', postId: 'p1', noteId: 'ghost', trigger: 'x' }] })));
    expect(findings).toHaveLength(0);
  });

  it('malformed output yields zero findings, never throws', async () => {
    expect(await runAudit(baseInput({}), fakeModel('not json'))).toHaveLength(0);
  });
});

describe('applyCaps (code-enforced)', () => {
  const clanger = (i: number): Finding => ({ type: 'clanger', severity: 'fix', postId: `p${i}`, trigger: `t${i}` });

  it('caps rewrites: 5 clangers → 3 actioned, 2 reported', () => {
    const { actioned, skipped } = applyCaps([clanger(1), clanger(2), clanger(3), clanger(4), clanger(5)], { maxWeather: 1, maxRewrite: 3 });
    expect(actioned).toHaveLength(3);
    expect(skipped).toHaveLength(2);
  });

  it('caps weather at maxWeather (2 opportunities → 1 actioned)', () => {
    const w = (n: string): Finding => ({ type: 'weather_opportunity', severity: 'suggest', trigger: n });
    const { actioned, skipped } = applyCaps([w('a'), w('b')], { maxWeather: 1, maxRewrite: 3 });
    expect(actioned).toHaveLength(1);
    expect(skipped).toHaveLength(1);
  });

  it('date_conflict moves are uncapped', () => {
    const dc = (i: number): Finding => ({ type: 'date_conflict', severity: 'fix', postId: `p${i}`, toDate: '2026-07-20', trigger: 't' });
    const { actioned } = applyCaps([dc(1), dc(2), dc(3), dc(4)], { maxWeather: 1, maxRewrite: 3 });
    expect(actioned).toHaveLength(4);
  });
});

describe('messages', () => {
  it('quiet-week message names the week', () => {
    expect(quietMessage('2026-03-16')).toBe('Checked w/c 16 Mar 2026: forecast unremarkable, no maturing notes, no conflicts — no changes proposed.');
  });
  it('change message lists proposals and notes skipped count', () => {
    const m = changeMessage('2026-03-16', ['Move X → Y — because', 'Rewrite Z — because'], 2);
    expect(m).toContain('2 changes proposed');
    expect(m).toContain('• Move X → Y — because');
    expect(m).toContain('2 further findings');
  });
  it('fmtWeekOf formats the Monday', () => {
    expect(fmtWeekOf('2026-07-13')).toBe('w/c 13 Jul 2026');
  });
});

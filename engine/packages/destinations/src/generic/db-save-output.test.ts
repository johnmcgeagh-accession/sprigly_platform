import { describe, it, expect, vi } from 'vitest';
import { DbSaveOutput } from './db-save-output.js';
import type { IncomingEvent, DeliveryContext } from '@sprigly/engine';

const mockReturning = vi.fn().mockResolvedValue([{ id: 'row-1' }]);
const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockDb = { insert: mockInsert } as unknown as Parameters<typeof DbSaveOutput>[0];

const makeEvent = (): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: {},
  receivedAt: new Date(),
  content: { text: 'Prospect: Test Firm' },
  reply: { channel: 'email', data: {} },
});

const makeCtx = (): DeliveryContext => ({
  runId: 'run-1',
  workflowId: 'sprigly-prospect-research',
  clientId: 'client-1',
});

describe('DbSaveOutput', () => {
  it('stores only the data field when output has a data envelope', async () => {
    const destination = new DbSaveOutput(mockDb);
    const pdf = Buffer.from('%PDF-1.4 test');
    const data = { brandName: 'Test Firm', url: 'test.co.uk' };
    const output = { data, pdf };

    await destination.deliver(output, makeEvent(), {}, makeCtx());

    const insertedOutput = mockValues.mock.calls.at(-1)?.[0].output;
    // data field extracted — ProspectBriefData is stored directly
    expect(insertedOutput).toEqual(data);
    // PDF Buffer is NOT in the stored output at all
    expect(JSON.stringify(insertedOutput)).not.toContain('PDF');
    expect(JSON.stringify(insertedOutput)).not.toContain('[binary]');
  });

  it('strips Buffer to "[binary]" when output has no data envelope', async () => {
    const destination = new DbSaveOutput(mockDb);
    const output = { title: 'My Post', pdf: Buffer.from('%PDF') };

    await destination.deliver(output, makeEvent(), {}, makeCtx());

    const insertedOutput = mockValues.mock.calls.at(-1)?.[0].output;
    expect(insertedOutput).toEqual({ title: 'My Post', pdf: '[binary]' });
  });

  it('populates workflowId from DeliveryContext', async () => {
    const destination = new DbSaveOutput(mockDb);
    await destination.deliver({ brandName: 'X' }, makeEvent(), {}, makeCtx());

    const insertedRow = mockValues.mock.calls.at(-1)?.[0];
    expect(insertedRow.workflowId).toBe('sprigly-prospect-research');
    expect(insertedRow.workflowRunId).toBe('run-1');
  });

  it('returns success with workflowOutputId', async () => {
    const destination = new DbSaveOutput(mockDb);
    const result = await destination.deliver({ brandName: 'X' }, makeEvent(), {}, makeCtx());
    expect(result.success).toBe(true);
    expect(result.metadata?.['workflowOutputId']).toBe('row-1');
  });
});

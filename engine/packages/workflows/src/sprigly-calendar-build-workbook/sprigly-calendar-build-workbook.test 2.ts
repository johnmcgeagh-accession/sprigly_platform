import { describe, it, expect } from 'vitest';
import type { IncomingEvent } from '@sprigly/engine';
import { parseCalendarBuildWorkbookInput } from './parse-input.js';
import { createCalendarBuildWorkbookWorkflow } from './sprigly-calendar-build-workbook.js';

const makeDriveEvent = (overrides: Partial<Record<string, unknown>> = {}): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'drive',
  sourceMetadata: {
    csvFileId:     'file-abc',
    csvName:       '2026-07_ivy-t-instagram.csv',
    channel:       'instagram',
    driveFolderId: 'folder-xyz',
    from:          'ivy@example.com',
    ...overrides,
  },
  receivedAt: new Date(),
  content: { text: 'CSV updated: 2026-07_ivy-t-instagram.csv' },
  reply: { channel: 'drive', data: {} },
});

describe('parseCalendarBuildWorkbookInput', () => {
  it('extracts all fields from sourceMetadata', () => {
    const result = parseCalendarBuildWorkbookInput(makeDriveEvent());
    expect(result).toMatchObject({
      clientId:     'client-1',
      channel:      'instagram',
      csvFileId:    'file-abc',
      csvName:      '2026-07_ivy-t-instagram.csv',
      driveFolderId: 'folder-xyz',
    });
  });

  it('returns null when csvFileId is missing', () => {
    expect(parseCalendarBuildWorkbookInput(makeDriveEvent({ csvFileId: undefined }))).toBeNull();
  });

  it('returns null when csvName is missing', () => {
    expect(parseCalendarBuildWorkbookInput(makeDriveEvent({ csvName: undefined }))).toBeNull();
  });

  it('returns null when channel is missing', () => {
    expect(parseCalendarBuildWorkbookInput(makeDriveEvent({ channel: undefined }))).toBeNull();
  });

  it('returns null when driveFolderId is missing', () => {
    expect(parseCalendarBuildWorkbookInput(makeDriveEvent({ driveFolderId: undefined }))).toBeNull();
  });
});

describe('createCalendarBuildWorkbookWorkflow', () => {
  it('returns a workflow with the correct id', () => {
    const wf = createCalendarBuildWorkbookWorkflow(
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[0],
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[1],
      'client-id', 'client-secret', '/path/to/script.py', 'python3',
    );
    expect(wf.id).toBe('sprigly-calendar-build-workbook');
  });

  it('routes to gmail-reply-with-attachment by default', () => {
    const wf = createCalendarBuildWorkbookWorkflow(
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[0],
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[1],
      'client-id', 'client-secret', '/path/to/script.py', 'python3',
    );
    expect(wf.defaultDestinations[0]?.destinationId).toBe('gmail-reply-with-attachment');
    expect((wf.defaultDestinations[0]?.settings as Record<string, unknown>)?.['attachmentDataKey']).toBe('xlsx');
  });

  it('parses valid Drive event', () => {
    const wf = createCalendarBuildWorkbookWorkflow(
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[0],
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[1],
      'client-id', 'client-secret', '/path/to/script.py', 'python3',
    );
    const result = wf.parseInput(makeDriveEvent());
    expect(result).toMatchObject({ csvFileId: 'file-abc', channel: 'instagram' });
  });

  it('returns null for event missing required fields', () => {
    const wf = createCalendarBuildWorkbookWorkflow(
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[0],
      {} as Parameters<typeof createCalendarBuildWorkbookWorkflow>[1],
      'client-id', 'client-secret', '/path/to/script.py', 'python3',
    );
    expect(wf.parseInput(makeDriveEvent({ csvFileId: undefined }))).toBeNull();
  });
});

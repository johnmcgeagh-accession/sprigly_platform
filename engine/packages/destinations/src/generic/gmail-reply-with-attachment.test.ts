import { describe, it, expect } from 'vitest';
import { substituteTemplate } from './template.js';
import { composeMimeWithAttachment, resolveAttachmentBuffer } from './gmail-reply-with-attachment.js';

// ── substituteTemplate ────────────────────────────────────────────────────────

describe('substituteTemplate', () => {
  it('substitutes a simple key', () => {
    expect(substituteTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('substitutes multiple keys', () => {
    expect(substituteTemplate('{{a}} and {{b}}', { a: 'foo', b: 'bar' })).toBe('foo and bar');
  });

  it('substitutes a nested key via dot notation', () => {
    expect(substituteTemplate('{{a.b}}', { a: { b: 'nested' } as unknown as Record<string, unknown> })).toBe('nested');
  });

  it('returns empty string for a missing key', () => {
    expect(substituteTemplate('{{missing}}', {})).toBe('');
  });

  it('returns empty string for a null value', () => {
    expect(substituteTemplate('{{x}}', { x: null })).toBe('');
  });

  it('coerces number values to string', () => {
    expect(substituteTemplate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
  });

  it('leaves non-template text unchanged', () => {
    expect(substituteTemplate('no placeholders', {})).toBe('no placeholders');
  });

  it('handles a template with only a placeholder', () => {
    expect(substituteTemplate('{{brandName}}', { brandName: 'Ivy Tax Partners' })).toBe('Ivy Tax Partners');
  });
});

// ── composeMimeWithAttachment ─────────────────────────────────────────────────

const BASE_PARAMS = {
  toEmail: 'john@aigura.co.uk',
  fromEmail: 'sprigly@gmail.com',
  subject: 'Prospect brief: Ivy Tax Partners',
  bodyText: 'Ivy Tax Partners\r\n\r\nPDF attached.',
  attachmentFilename: 'Ivy-Tax-Partners-prospect-brief.pdf',
  attachmentMimeType: 'application/pdf',
  bodyMimeType: 'text/plain' as const,
};

describe('composeMimeWithAttachment', () => {
  it('PDF Buffer bytes are base64-encoded verbatim in the attachment part', () => {
    const pdf = Buffer.from('%PDF-1.4 real content here');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain(pdf.toString('base64'));
  });

  it('PDF content is NOT replaced with "[binary]" placeholder', () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).not.toContain('[binary]');
  });

  it('contains both body MIME part and attachment MIME part', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: application/pdf');
  });

  it('renders the subject header', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain('Subject: Prospect brief: Ivy Tax Partners');
  });

  it('renders the To and From headers', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain('To: john@aigura.co.uk');
    expect(raw).toContain('From: sprigly@gmail.com');
  });

  it('includes the attachment filename in the Content-Disposition header', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain('filename="Ivy-Tax-Partners-prospect-brief.pdf"');
  });

  it('uses text/html body MIME type when specified', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf, bodyMimeType: 'text/html' });
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).not.toContain('Content-Type: text/plain');
  });

  it('uses a custom attachment MIME type when specified', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf, attachmentMimeType: 'application/octet-stream' });
    expect(raw).toContain('Content-Type: application/octet-stream');
  });

  it('body text appears verbatim in the message', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const raw = composeMimeWithAttachment({ ...BASE_PARAMS, attachmentData: pdf });
    expect(raw).toContain('Ivy Tax Partners');
    expect(raw).toContain('PDF attached.');
  });
});

// ── resolveAttachmentBuffer ───────────────────────────────────────────────────
// Covers the attachmentDataKey behaviour added in Fix 3.
// Default key is 'pdf' (all existing callers are unaffected).
// Calendar xlsx delivery sets key to 'xlsx'.

describe('resolveAttachmentBuffer', () => {
  it("returns the buffer when the key is 'pdf' (default caller contract)", () => {
    const buf = Buffer.from('%PDF-1.4');
    expect(resolveAttachmentBuffer({ pdf: buf }, 'pdf')).toBe(buf);
  });

  it("returns the buffer when the key is 'xlsx' (calendar xlsx delivery)", () => {
    const buf = Buffer.from('PK'); // xlsx magic bytes
    expect(resolveAttachmentBuffer({ xlsx: buf }, 'xlsx')).toBe(buf);
  });

  it('returns null when the key is absent', () => {
    const buf = Buffer.from('%PDF-1.4');
    expect(resolveAttachmentBuffer({ pdf: buf }, 'xlsx')).toBeNull();
  });

  it('returns null when the value at the key is not a Buffer', () => {
    expect(resolveAttachmentBuffer({ pdf: 'not-a-buffer' }, 'pdf')).toBeNull();
    expect(resolveAttachmentBuffer({ pdf: 42 }, 'pdf')).toBeNull();
    expect(resolveAttachmentBuffer({ pdf: null }, 'pdf')).toBeNull();
    expect(resolveAttachmentBuffer({ pdf: undefined }, 'pdf')).toBeNull();
  });

  it('returns null for an empty output object', () => {
    expect(resolveAttachmentBuffer({}, 'pdf')).toBeNull();
  });
});

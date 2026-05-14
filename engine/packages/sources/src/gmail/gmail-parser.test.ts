import { describe, it, expect } from 'vitest';
import type { gmail_v1 } from 'googleapis';
import {
  decodeBase64Url,
  stripHtml,
  getHeader,
  extractTextFromParts,
  extractMessageText,
  parseReceivedAt,
} from './gmail-parser.js';

describe('decodeBase64Url', () => {
  it('decodes standard base64url to utf-8', () => {
    const encoded = Buffer.from('Hello World', 'utf-8').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Hello World');
  });

  it('handles Gmail-style characters (- and _)', () => {
    // base64url uses - instead of + and _ instead of /
    const json = '{"accessToken":"test+value/here"}';
    const encoded = Buffer.from(json, 'utf-8').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe(json);
  });

  it('decodes without padding', () => {
    const encoded = Buffer.from('Blog: AI in Healthcare', 'utf-8').toString('base64url');
    // base64url encoding has no = padding
    expect(encoded).not.toContain('=');
    expect(decodeBase64Url(encoded)).toBe('Blog: AI in Healthcare');
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&amp; &lt;tag&gt; &quot;hello&quot; &nbsp;')).toBe('& <tag> "hello"');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  too   many   spaces  </p>')).toBe('too many spaces');
  });

  it('handles nested tags', () => {
    expect(stripHtml('<div><p>Paragraph <span>text</span></p></div>')).toBe('Paragraph text');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('getHeader', () => {
  const headers: gmail_v1.Schema$MessagePartHeader[] = [
    { name: 'From', value: 'john@example.com' },
    { name: 'Subject', value: 'Blog: AI Tools' },
    { name: 'Date', value: 'Mon, 12 May 2026 10:00:00 +0000' },
  ];

  it('returns value for exact match', () => {
    expect(getHeader(headers, 'From')).toBe('john@example.com');
  });

  it('is case-insensitive', () => {
    expect(getHeader(headers, 'subject')).toBe('Blog: AI Tools');
    expect(getHeader(headers, 'SUBJECT')).toBe('Blog: AI Tools');
  });

  it('returns empty string for missing header', () => {
    expect(getHeader(headers, 'To')).toBe('');
  });

  it('returns empty string for empty headers array', () => {
    expect(getHeader([], 'Subject')).toBe('');
  });
});

describe('extractTextFromParts', () => {
  const encodedText = (text: string) => Buffer.from(text, 'utf-8').toString('base64url');

  it('returns decoded text/plain body', () => {
    const part: gmail_v1.Schema$MessagePart = {
      mimeType: 'text/plain',
      body: { data: encodedText('Blog: AI Tools in Healthcare') },
    };
    expect(extractTextFromParts(part)).toBe('Blog: AI Tools in Healthcare');
  });

  it('prefers text/plain over text/html in multipart', () => {
    const part: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: encodedText('Plain text body') },
        },
        {
          mimeType: 'text/html',
          body: { data: encodedText('<p>HTML body</p>') },
        },
      ],
    };
    expect(extractTextFromParts(part)).toBe('Plain text body');
  });

  it('falls back to stripped text/html when no text/plain exists', () => {
    const part: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/html',
          body: { data: encodedText('<p>HTML only body</p>') },
        },
      ],
    };
    expect(extractTextFromParts(part)).toBe('HTML only body');
  });

  it('finds text/plain in nested multipart/mixed', () => {
    const part: gmail_v1.Schema$MessagePart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: encodedText('Nested plain text') },
            },
          ],
        },
      ],
    };
    expect(extractTextFromParts(part)).toBe('Nested plain text');
  });

  it('returns empty string for unrecognised MIME type with no parts', () => {
    const part: gmail_v1.Schema$MessagePart = {
      mimeType: 'application/pdf',
      body: { size: 1024 },
    };
    expect(extractTextFromParts(part)).toBe('');
  });
});

describe('extractMessageText', () => {
  const encodedText = (text: string) => Buffer.from(text, 'utf-8').toString('base64url');

  it('decodes simple message with payload.body.data', () => {
    const message: gmail_v1.Schema$Message = {
      payload: {
        mimeType: 'text/plain',
        body: { data: encodedText('Simple email body') },
      },
    };
    expect(extractMessageText(message)).toBe('Simple email body');
  });

  it('traverses multipart payload', () => {
    const message: gmail_v1.Schema$Message = {
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: encodedText('Multipart plain') },
          },
        ],
      },
    };
    expect(extractMessageText(message)).toBe('Multipart plain');
  });

  it('returns empty string when payload is undefined', () => {
    const message: gmail_v1.Schema$Message = {};
    expect(extractMessageText(message)).toBe('');
  });
});

describe('parseReceivedAt', () => {
  it('parses internalDate (milliseconds since epoch as string)', () => {
    const ts = Date.now();
    const message: gmail_v1.Schema$Message = { internalDate: String(ts) };
    expect(parseReceivedAt(message).getTime()).toBe(ts);
  });

  it('returns a recent date when internalDate is missing', () => {
    const before = Date.now();
    const result = parseReceivedAt({});
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });
});

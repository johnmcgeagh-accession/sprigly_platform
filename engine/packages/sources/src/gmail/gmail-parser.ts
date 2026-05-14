import type { gmail_v1 } from 'googleapis';

export function decodeBase64Url(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf-8');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string {
  const lower = name.toLowerCase();
  const header = headers.find((h) => (h.name ?? '').toLowerCase() === lower);
  return header?.value ?? '';
}

export function extractTextFromParts(part: gmail_v1.Schema$MessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.parts && part.parts.length > 0) {
    // First pass: look for text/plain anywhere in the tree
    for (const subpart of part.parts) {
      const text = extractTextFromParts(subpart);
      if (text !== '') return text;
    }
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return stripHtml(decodeBase64Url(part.body.data));
  }

  return '';
}

export function extractMessageText(message: gmail_v1.Schema$Message): string {
  if (!message.payload) return '';

  if (message.payload.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }

  if (message.payload.parts && message.payload.parts.length > 0) {
    for (const part of message.payload.parts) {
      const text = extractTextFromParts(part);
      if (text !== '') return text;
    }
  }

  return '';
}

export function parseReceivedAt(message: gmail_v1.Schema$Message): Date {
  if (message.internalDate) {
    return new Date(Number(message.internalDate));
  }
  return new Date();
}

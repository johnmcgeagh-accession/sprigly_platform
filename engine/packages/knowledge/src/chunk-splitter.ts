import { stripHtml } from '@sprigly/sources';

const MAX_CHUNK_CHARS = 1500;
const MIN_CHUNK_CHARS = 20;

export function splitText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (para.length > MAX_CHUNK_CHARS) {
      if (current) { chunks.push(current); current = ''; }
      // Split on sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current.length + sentence.length + 2 <= MAX_CHUNK_CHARS) {
          current = current ? `${current}\n\n${sentence}` : sentence;
        } else {
          if (current) chunks.push(current);
          current = sentence.slice(0, MAX_CHUNK_CHARS);
        }
      }
    } else if (current.length + para.length + 2 <= MAX_CHUNK_CHARS) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) chunks.push(current);
      current = para;
    }
  }
  if (current) chunks.push(current);

  return chunks.filter((c) => c.length >= MIN_CHUNK_CHARS);
}

export function extractQABlocks(html: string): string[] {
  const blocks: string[] = [];

  // Pattern 1: <dt>Q</dt><dd>A</dd> (definition lists)
  const dtddRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = dtddRe.exec(html)) !== null) {
    const q = stripHtml(m[1] ?? '').trim();
    const a = stripHtml(m[2] ?? '').trim();
    if (q && a) blocks.push(`Q: ${q}\n\nA: ${a}`);
  }
  if (blocks.length > 0) return blocks;

  // Pattern 2: heading ending with ? followed by paragraphs
  const headingRe = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>\s*((?:<p[^>]*>[\s\S]*?<\/p>\s*)+)/gi;
  while ((m = headingRe.exec(html)) !== null) {
    const q = stripHtml(m[1] ?? '').trim();
    if (!q.endsWith('?')) continue;
    const rawAnswer = m[2] ?? '';
    const a = stripHtml(rawAnswer).trim();
    if (q && a) blocks.push(`Q: ${q}\n\nA: ${a}`);
  }
  if (blocks.length > 0) return blocks;

  // Pattern 3: text-level Q: / A: markers
  const text = stripHtml(html);
  const qaTextRe = /Q:\s*(.+?)[\n\r]+A:\s*([\s\S]+?)(?=[\n\r]+Q:|[\n\r]{3,}|$)/g;
  while ((m = qaTextRe.exec(text)) !== null) {
    const q = (m[1] ?? '').trim();
    const a = (m[2] ?? '').trim();
    if (q && a) blocks.push(`Q: ${q}\n\nA: ${a}`);
  }
  if (blocks.length > 0) return blocks;

  // Fallback: paragraph split
  return splitText(stripHtml(html));
}

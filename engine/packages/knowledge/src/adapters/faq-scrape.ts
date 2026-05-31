import { extractQABlocks } from '../chunk-splitter.js';
import type { RawChunk } from '../types.js';

export async function faqScrapeChunks(url: string): Promise<RawChunk[]> {
  let html: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Sprigly-Ingest/1.0' } });
    html = await res.text();
  } catch (err) {
    console.warn(`[knowledge] faq_scrape: failed to fetch ${url}`, err);
    return [];
  }

  const contents = extractQABlocks(html);
  return contents.map((content) => ({ content, ref: url }));
}

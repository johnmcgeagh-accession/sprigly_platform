import { splitText } from '../chunk-splitter.js';
import type { RawChunk } from '../types.js';

export function manualChunks(text: string): RawChunk[] {
  return splitText(text).map((content) => ({ content }));
}

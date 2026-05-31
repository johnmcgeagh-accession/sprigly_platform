import { splitText } from '../chunk-splitter.js';
import type { RawChunk } from '../types.js';

export function approvedDraftChunks(text: string, ref: string): RawChunk[] {
  return splitText(text).map((content) => ({ content, ref }));
}

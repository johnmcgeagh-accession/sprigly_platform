import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { ProspectBrief, type ProspectBriefData } from './documents/ProspectBrief.js';

export type DocumentType = 'prospect-brief';

export interface RenderParams {
  'prospect-brief': ProspectBriefData;
}

export async function render<T extends DocumentType>(
  type: T,
  data: RenderParams[T],
): Promise<Buffer> {
  if (type === 'prospect-brief') {
    const el = React.createElement(ProspectBrief, { data: data as ProspectBriefData });
    return renderToBuffer(el as ReactElement<DocumentProps>);
  }
  throw new Error(`Unknown document type: ${type as string}`);
}

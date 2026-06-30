import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { ProspectBrief, type ProspectBriefData } from './documents/ProspectBrief.js';
import { Document, Page, View, Text, StyleSheet } from './pdf-elements.js';
import { COLOURS, FONT, SPACING } from './theme.js';

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

const noDataStyles = StyleSheet.create({
  page:    { backgroundColor: COLOURS.offWhite, padding: SPACING.xl * 2, fontFamily: FONT.family },
  heading: { fontSize: FONT.sizes.xl, color: COLOURS.navy, marginBottom: SPACING.md },
  body:    { fontSize: FONT.sizes.body, color: COLOURS.midGrey, lineHeight: 1.6 },
});

export async function renderNoData(brandName: string): Promise<Buffer> {
  const el = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: noDataStyles.page },
      React.createElement(View, null,
        React.createElement(Text, { style: noDataStyles.heading }, brandName),
        React.createElement(
          Text,
          { style: noDataStyles.body },
          'No research data was found for this firm. Web searches returned no results.\n\n' +
          'Please try again with a website URL, or provide additional context in the email body.',
        ),
      ),
    ),
  );
  return renderToBuffer(el as ReactElement<DocumentProps>);
}

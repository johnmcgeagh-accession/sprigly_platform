import { Font } from '@react-pdf/renderer';

// Alias built-in Helvetica as our custom font families so react-pdf accepts
// them during tests without network requests or font file I/O.
// PDFs render with Helvetica glyphs — visual fidelity is irrelevant; only
// buffer validity is tested.
const helveticaFamily = Font.fontFamilies['Helvetica'];
if (helveticaFamily !== undefined) {
  Font.fontFamilies['Inter']            = helveticaFamily;
  Font.fontFamilies['DM Serif Display'] = helveticaFamily;
}

/**
 * Re-exports @react-pdf/renderer components with React.FC types.
 * react-pdf v4 components extend React.Component, which causes a TS2786
 * "cannot be used as a JSX component" error with @types/react ≥ 18.3
 * (refs property changed). Casting via unknown resolves the mismatch
 * without weakening runtime behaviour.
 */
import type { FC, PropsWithChildren } from 'react';
import {
  Document as _Document,
  Page as _Page,
  View as _View,
  Text as _Text,
  Svg as _Svg,
  Path as _Path,
  Image as _Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type {
  DocumentProps,
  PageProps,
  ViewProps,
  TextProps,
  SVGProps,
  PathProps,
  ImageProps,
} from '@react-pdf/renderer';

export const Document = _Document as unknown as FC<PropsWithChildren<DocumentProps>>;
export const Page     = _Page     as unknown as FC<PropsWithChildren<PageProps>>;
export const View     = _View     as unknown as FC<PropsWithChildren<ViewProps>>;
export const Text     = _Text     as unknown as FC<PropsWithChildren<TextProps>>;
export const Svg      = _Svg      as unknown as FC<PropsWithChildren<SVGProps>>;
export const Path     = _Path     as unknown as FC<PathProps>;
export const Image    = _Image    as unknown as FC<ImageProps>;
export { StyleSheet, Font };

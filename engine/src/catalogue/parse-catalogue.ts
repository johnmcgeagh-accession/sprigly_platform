/**
 * parse-catalogue.ts — MOVED to @sprigly/engine (packages/engine/src/catalogue) so
 * the admin sales-upload path can rebuild the catalogue server-side too. This file
 * is now a thin re-export to keep the worker's existing relative imports working.
 * Edit the parser in @sprigly/engine, not here.
 */
export {
  buildCatalogue,
  parseProductTitle,
  type Catalogue,
  type ParsedProduct,
  type ProductFamily,
  type ProductStatus,
  type SalesRow,
  type VariantSales,
} from '@sprigly/engine';

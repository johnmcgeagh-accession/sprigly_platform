# Backlog

Technical debt and deferred cleanup items. Address when the relevant area is being actively worked.

---

## Destinations

### Drop `prospect_sheets` table and `DbSaveProspectSheet` destination class

`prospect_sheets` was created in migration `0000` as initial scaffolding before the generic `workflow_outputs` pattern was established. `DbSaveProspectSheet` was built against it in Phase 3 but is unwired — the prospect research workflow now routes through `db-save-output`.

**To do:**
1. Confirm no historical prospect data exists in `prospect_sheets` that needs referencing
2. Drop `DbSaveProspectSheet` class from `packages/destinations/src/prospect/db-save-prospect-sheet.ts`
3. Generate a drizzle migration to `DROP TABLE prospect_sheets`
4. Remove the `prospectSheets` export from `@sprigly/db`
5. Update `DbSaveOutput` comment that mentions `prospect_sheets` as exempt

**Why deferred:** No data in the table; no live references. Safe to drop at any time once confirmed.

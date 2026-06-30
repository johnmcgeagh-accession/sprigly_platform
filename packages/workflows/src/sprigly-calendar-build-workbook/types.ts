export interface SpriglyCalendarBuildWorkbookInput {
  clientId: string;
  channel: string;
  csvFileId: string;
  csvName: string;
  driveFolderId: string;
}

export interface SpriglyCalendarBuildWorkbookOutput {
  /** Exact filename written to Drive (e.g. "Ivy-T — Content calendar - July 2026.xlsx"). */
  filename: string;
  /** Full month name extracted from the filename (e.g. "July"). Used in email templates. */
  month: string;
  /** Four-digit year extracted from the filename (e.g. "2026"). Used in email templates. */
  year: string;
  /** Drive URL for the uploaded xlsx — included in the delivery email as the edit link. */
  driveUrl: string;
  /** App magic link (app.sprigly.co.uk) when the client's delivery surface includes
   *  'app'; null otherwise. */
  appUrl: string | null;
  /** Fully-composed email body, branched on the client's delivery_surface
   *  ('app' | 'sheet' | 'both'). The destination's bodyTemplate is just "{{body}}". */
  body: string;
}

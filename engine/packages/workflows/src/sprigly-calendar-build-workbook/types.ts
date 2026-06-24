export interface SpriglyCalendarBuildWorkbookInput {
  clientId: string;
  channel: string;
  csvFileId: string;
  csvName: string;
  driveFolderId: string;
}

export interface SpriglyCalendarBuildWorkbookOutput {
  /** Raw xlsx bytes — consumed by the gmail-reply-with-attachment destination (attachmentDataKey: 'xlsx'). */
  xlsx: Buffer;
  /** Exact filename written to Drive (e.g. "Ivy-T — Content calendar - July 2026.xlsx"). */
  filename: string;
  /** Full month name extracted from the filename (e.g. "July"). Used in email templates. */
  month: string;
  /** Four-digit year extracted from the filename (e.g. "2026"). Used in email templates. */
  year: string;
}

export { switchPollingMode } from './mailbox-mode.js';
export { parseEmailInput } from './email-parser/index.js';
export type { EmailInputSpec, BodyFieldSpec, ParsedEmailInput } from './email-parser/index.js';
export { GmailPoller } from './gmail/gmail-poller.js';
export { GmailApiClient } from './gmail/gmail-client.js';
export { createGmailReadStateService } from './gmail/gmail-read-state.js';
export { createGmailDraftService } from './gmail/gmail-draft-service.js';
export type { GmailDraftService, GmailDraftParams } from './gmail/gmail-draft-service.js';
export {
  extractMessageText,
  extractTextFromParts,
  decodeBase64Url,
  stripHtml,
  getHeader,
  parseReceivedAt,
} from './gmail/gmail-parser.js';

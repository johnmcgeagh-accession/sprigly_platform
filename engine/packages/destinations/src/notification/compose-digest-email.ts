export interface DigestItem {
  captureLogId: string;
  category: string;
  suggestedAction: string;
  subject: string;
  from: string;
  /** Present when suggestedAction = 'draft_reply' */
  draftText?: string;
  /** Present when suggestedAction = 'escalate' */
  escalationReason?: string;
}

export interface DigestEmailParams {
  toEmail: string;
  fromEmail: string;
  clientName: string;
  reviewUrl: string;
  items: DigestItem[];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function renderItem(item: DigestItem, index: number): string {
  const lines: string[] = [];
  lines.push(`${index + 1}. ${item.from}`);
  lines.push(`   Subject: ${item.subject}`);
  lines.push(`   Category: ${item.category}`);
  if (item.suggestedAction === 'escalate') {
    lines.push(`   Action: escalate`);
    if (item.escalationReason) {
      lines.push(`   Reason: ${truncate(item.escalationReason, 120)}`);
    }
  } else if (item.suggestedAction === 'draft_reply') {
    lines.push(`   Action: draft reply`);
    if (item.draftText) {
      lines.push(`   Draft: ${truncate(item.draftText, 120)}`);
    }
  } else {
    lines.push(`   Action: ${item.suggestedAction}`);
  }
  return lines.join('\r\n');
}

export function composeDigestEmail(params: DigestEmailParams): string {
  const { toEmail, fromEmail, clientName, reviewUrl, items } = params;

  const escalations = items.filter((i) => i.suggestedAction === 'escalate');
  const drafts = items.filter((i) => i.suggestedAction !== 'escalate');

  const totalCount = items.length;
  const subject = totalCount === 1
    ? `Sprigly: 1 item needs your attention`
    : `Sprigly: ${totalCount} items need your attention`;

  const bodyLines: string[] = [];

  bodyLines.push(`Hi ${clientName},`);
  bodyLines.push('');
  bodyLines.push(
    totalCount === 1
      ? `You have 1 item awaiting review.`
      : `You have ${totalCount} items awaiting review.`,
  );

  if (escalations.length > 0) {
    bodyLines.push('');
    bodyLines.push(`── ESCALATIONS (${escalations.length}) ──────────────────────────`);
    bodyLines.push('These need your direct attention.');
    bodyLines.push('');
    escalations.forEach((item, i) => {
      bodyLines.push(renderItem(item, i));
      bodyLines.push('');
    });
  }

  if (drafts.length > 0) {
    bodyLines.push('');
    bodyLines.push(`── DRAFT REPLIES (${drafts.length}) ──────────────────────────`);
    bodyLines.push('Review and approve, modify, or reject each draft.');
    bodyLines.push('');
    drafts.forEach((item, i) => {
      bodyLines.push(renderItem(item, escalations.length + i));
      bodyLines.push('');
    });
  }

  bodyLines.push('');
  bodyLines.push('── REVIEW ──────────────────────────────────────────');
  bodyLines.push(reviewUrl);
  bodyLines.push('');
  bodyLines.push('This link is valid for 72 hours. All actions happen on the review page.');

  const body = bodyLines.join('\r\n');

  return [
    `To: ${toEmail}`,
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ].join('\r\n');
}

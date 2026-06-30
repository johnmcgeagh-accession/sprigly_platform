export interface OutputEmailParams {
  toEmail: string;
  fromEmail: string;
  workflowId: string;
  subject: string;
  bodyText: string;
}

export function composeOutputEmail(params: OutputEmailParams): string {
  const { toEmail, fromEmail, subject, bodyText } = params;

  return [
    `To: ${toEmail}`,
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    bodyText,
  ].join('\r\n');
}

export function formatOutputAsText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output !== null && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    const lines: string[] = [];

    if (typeof obj['title'] === 'string') lines.push(`Title: ${obj['title']}`);
    if (typeof obj['body'] === 'string') lines.push('', obj['body']);
    else lines.push('', JSON.stringify(output, null, 2));

    return lines.join('\r\n');
  }
  return String(output);
}

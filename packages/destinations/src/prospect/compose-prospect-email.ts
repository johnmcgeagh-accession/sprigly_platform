import { randomUUID } from 'node:crypto';
import type { ProspectBriefData } from '@sprigly/pdf-render';

export interface ProspectEmailParams {
  toEmail: string;
  fromEmail: string;
  data: ProspectBriefData;
  pdf: Buffer;
}

function buildBodyText(data: ProspectBriefData): string {
  const pipeline = data.pipelines[0];
  const risk = data.risks[0];
  const lines = [
    `Prospect brief ready: ${data.brandName}`,
    '',
    `- What they do: ${data.execSummary.whatTheyActuallyDo}`,
  ];
  if (pipeline) lines.push(`- Top pipeline: ${pipeline.name} — ${pipeline.qualifier}`);
  if (risk) lines.push(`- Key risk: ${risk.title} — ${risk.detail}`);
  lines.push('', 'PDF attached.');
  return lines.join('\r\n');
}

export function composeProspectEmail(params: ProspectEmailParams): string {
  const { toEmail, fromEmail, data, pdf } = params;
  const boundary = `----=_Part_${randomUUID().replace(/-/g, '')}`;
  const bodyText = buildBodyText(data);
  const filename = `${data.brandName.replace(/[^a-zA-Z0-9-]/g, '-')}-prospect-brief.pdf`;
  const pdfBase64 = pdf.toString('base64');

  return [
    `To: ${toEmail}`,
    `From: ${fromEmail}`,
    `Subject: Prospect brief: ${data.brandName}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    pdfBase64,
    `--${boundary}--`,
  ].join('\r\n');
}

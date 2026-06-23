/**
 * setup-drive-oauth.ts — authorize a Google account for Drive access and store
 * the encrypted tokens in oauth_connections under provider='drive'.
 *
 * Usage: tsx src/setup-drive-oauth.ts <client-slug>
 *
 * Scope: https://www.googleapis.com/auth/drive
 *   Full Drive access is required because the worker must:
 *     - list files in a shared folder (including xlsx files uploaded by clients, not
 *       created by the worker — which rules out the narrower drive.file scope)
 *     - download xlsx files the client returns
 *     - upload generated xlsx and write voice.md back to Drive
 *
 *   Restrict to drive.readonly + drive.file once the access patterns are confirmed stable.
 *
 * Gate 2 verification: after running this script, run verify-drive-token.ts to confirm
 * the stored tokens decrypt correctly and the Drive API responds to a real request.
 *
 * Requires: AWS_KMS_KEY_ID (production) or LOCAL_DEV_ENCRYPTION_KEY (development)
 *           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *           DATABASE_URL
 */

import http from 'node:http';
import { google } from 'googleapis';
import { db, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';
import { env } from './env.js';

const REDIRECT_URI = 'http://localhost:3456';
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
];

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: tsx src/setup-drive-oauth.ts <client-slug>');
  process.exit(1);
}

const rows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const client = rows[0];
if (!client) {
  console.error(`Client not found: ${slug}`);
  process.exit(1);
}

const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);

const authUrl = auth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for OAuth callback on http://localhost:3456 ...\n');

const code = await new Promise<string>((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost:3000');
    const receivedCode = url.searchParams.get('code');
    if (receivedCode) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization successful. You can close this tab.</h1>');
      server.close();
      resolve(receivedCode);
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code parameter');
      server.close();
      reject(new Error('OAuth callback missing code parameter'));
    }
  });
  server.listen(3456);
});

const { tokens } = await auth.getToken(code);

// Resolve the authorized account's email via Drive about.get.
auth.setCredentials(tokens);
const drive = google.drive({ version: 'v3', auth });
let emailAddress: string | undefined;
try {
  const about = await drive.about.get({ fields: 'user' });
  emailAddress = about.data.user?.emailAddress ?? undefined;
} catch {
  console.warn('Could not fetch Drive account email — connection will be stored without it.');
}

const encProvider = createEncryptionProvider();

const bundle: OAuthTokenBundle = {
  accessToken: tokens.access_token ?? '',
  scopes: SCOPES,
  ...(typeof tokens.refresh_token === 'string' && { refreshToken: tokens.refresh_token }),
  ...(tokens.expiry_date != null && { expiresAt: tokens.expiry_date }),
  ...(emailAddress !== undefined && { emailAddress }),
};

await storeTokens(db, encProvider, client.id, 'drive', bundle);

console.log(`\nTokens stored for client '${slug}' (provider: drive).`);
if (emailAddress !== undefined) {
  console.log(`Drive account: ${emailAddress}`);
}
console.log('Run: tsx src/verify-drive-token.ts ' + slug + ' [folder-id]');

process.exit(0);

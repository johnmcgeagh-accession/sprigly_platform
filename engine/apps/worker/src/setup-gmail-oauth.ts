import http from 'node:http';
import { google } from 'googleapis';
import { db, oauthConnections } from '@sprigly/db';
import { clients } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';
import { env } from './env.js';

const REDIRECT_URI = 'http://localhost:3456';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];


const slug = process.argv[2];
if (!slug) {
  console.error('Usage: tsx src/setup-gmail-oauth.ts <client-slug>');
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

// Fetch the authorised account's email address before storing tokens.
auth.setCredentials(tokens);
const gmail = google.gmail({ version: 'v1', auth });
let emailAddress: string | undefined;
try {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  emailAddress = profile.data.emailAddress ?? undefined;
} catch {
  console.warn('Could not fetch Gmail profile email address — connection will be stored without it.');
}

const encProvider = createEncryptionProvider();

const bundle: OAuthTokenBundle = {
  accessToken: tokens.access_token ?? '',
  scopes: SCOPES,
  ...(typeof tokens.refresh_token === 'string' && { refreshToken: tokens.refresh_token }),
  ...(tokens.expiry_date != null && { expiresAt: tokens.expiry_date }),
  ...(emailAddress !== undefined && { emailAddress }),
};

await storeTokens(db, encProvider, client.id, 'gmail', bundle);

// Set the polling watermark to now so the first poll cycle does not reach back
// through the client's inbox history.
await db
  .update(oauthConnections)
  .set({ lastPolledAt: new Date(), updatedAt: new Date() })
  .where(
    and(
      eq(oauthConnections.clientId, client.id),
      eq(oauthConnections.provider, 'gmail'),
    ),
  );

console.log(`\nTokens stored for client '${slug}'.`);
if (emailAddress !== undefined) {
  console.log(`Email address: ${emailAddress}`);
}
console.log('oauth_connections row created. Worker is ready to poll Gmail.');

process.exit(0);

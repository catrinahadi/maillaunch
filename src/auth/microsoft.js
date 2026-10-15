import http from 'node:http';
import { URL } from 'node:url';
import { PublicClientApplication, LogLevel } from '@azure/msal-node';
import { loadCredentials, saveCredentials } from '../campaign/store.js';

const SCOPES = ['User.Read', 'Mail.Send', 'offline_access']; // request the permissions needed to send mail and refresh tokens
export async function authenticateMicrosoft(config) {
  if (!config.microsoft.client_id) throw new Error('Configure microsoft.client_id or MAILLAUNCH_MICROSOFT_CLIENT_ID first.'); // validate the app registration before auth
  const app = new PublicClientApplication({ auth: { clientId: config.microsoft.client_id, authority: `https://login.microsoftonline.com/${config.microsoft.tenant_id || 'common'}` }, system: { loggerOptions: { loggerCallback() {}, piiLoggingEnabled: false, logLevel: LogLevel.Error } } });
  const server = http.createServer();
  const port = Number(process.env.MAILLAUNCH_MICROSOFT_REDIRECT_PORT || 53683); // use the local port expected by microsoft oauth
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try {
    const redirectUri = `http://localhost:${port}`;
    const resultPromise = new Promise((resolve, reject) => {
      server.on('request', async (req, res) => {
        const url = new URL(req.url, redirectUri); const code = url.searchParams.get('code'); const error = url.searchParams.get('error');
        if (error) { res.writeHead(400).end('Authorization failed.'); reject(new Error(`${error}: ${url.searchParams.get('error_description') || ''}`)); return; }
        if (!code) { res.writeHead(200, { 'content-type': 'text/plain' }).end('Waiting for Microsoft sign-in...'); return; }
        try { const result = await app.acquireTokenByCode({ code, scopes: SCOPES, redirectUri }); res.writeHead(200, { 'content-type': 'text/plain' }).end('MailLaunch authorized. You may close this tab.'); resolve(result); }
        catch (e) { res.writeHead(400).end('Authorization failed.'); reject(e); }
      });
    });
    const authUrl = await app.getAuthCodeUrl({ scopes: SCOPES, redirectUri, prompt: 'select_account' });
    console.log(`Open this URL to authorize Microsoft 365:\n${authUrl}`);
    const result = await resultPromise;
    const all = loadCredentials(); all.microsoft = { username: result.account?.username || '', homeAccountId: result.account?.homeAccountId || '', cache: app.getTokenCache().serialize() }; saveCredentials(all); // persist the token cache for later silent refreshes
    console.log(`Authenticated Microsoft account: ${result.account?.username || 'account authorized'}`);
  } finally { server.close(); }
}
export async function microsoftToken(config, credentials, { forceRefresh = false } = {}) {
  if (!credentials?.cache) throw new Error('Microsoft is not authenticated. Run: maillaunch auth microsoft'); // enforce auth before sending
  const app = new PublicClientApplication({ auth: { clientId: config.microsoft.client_id, authority: `https://login.microsoftonline.com/${config.microsoft.tenant_id || 'common'}` } });
  await app.getTokenCache().deserialize(credentials.cache);
  const accounts = await app.getTokenCache().getAllAccounts();
  const account = accounts.find(a => a.homeAccountId === credentials.homeAccountId) || accounts[0];
  if (!account) throw new Error('Microsoft token cache has no account. Run: maillaunch auth microsoft'); // fail clearly when the saved account is missing
  try {
    const result = await app.acquireTokenSilent({ account, scopes: ['https://graph.microsoft.com/Mail.Send'], ...(forceRefresh ? { forceRefresh: true } : {}) });
    return { accessToken: result.accessToken, cache: app.getTokenCache().serialize(), account: result.account };
  } catch (e) { throw new Error(`Microsoft token refresh failed; run "maillaunch auth microsoft" again. ${e.message}`); } // surface a repair action when silent refresh fails
}

export async function refreshMicrosoftToken(config, credentials) {
  const result = await microsoftToken(config, credentials, { forceRefresh: true });
  credentials.cache = result.cache;
  credentials.username = result.account?.username || credentials.username;
  credentials.homeAccountId = result.account?.homeAccountId || credentials.homeAccountId;
  const all = loadCredentials();
  all.microsoft = {
    ...(all.microsoft || {}),
    ...credentials
  };
  saveCredentials(all);
}

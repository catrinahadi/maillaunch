import http from 'node:http';
import { URL } from 'node:url';
import open from 'open';
import { google } from 'googleapis';
import { loadCredentials, saveCredentials } from '../campaign/store.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send']; // only the minimum gmail permission needed for sending
export async function authenticateGmail(config) {
  if (!config.gmail.client_id || !config.gmail.client_secret) throw new Error('Configure Gmail client_id and MAILLAUNCH_GMAIL_CLIENT_SECRET first.'); // validate required config before starting oauth
  const redirect = new URL(config.gmail.redirect_uri);
  const oauth = new google.auth.OAuth2(config.gmail.client_id, config.gmail.client_secret, config.gmail.redirect_uri);
  const authUrl = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }); // request a refresh token for later use
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, config.gmail.redirect_uri);
      if (url.pathname !== redirect.pathname) { res.writeHead(404).end('Not found'); return; }
      const err = url.searchParams.get('error'), value = url.searchParams.get('code');
      res.writeHead(err ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' }).end(err ? 'Authorization failed. You may close this tab.' : 'MailLaunch authorized. You may close this tab.');
      server.close(); if (err) reject(new Error(`Google OAuth error: ${err}`)); else if (value) resolve(value); else reject(new Error('No OAuth code returned'));
    });
    server.on('error', reject); server.listen(Number(redirect.port || 80), redirect.hostname, async () => {
      console.log(`Opening Google authorization: ${authUrl}`);
      try { await open(authUrl); } catch { console.log(`Open this URL in your browser: ${authUrl}`); }
    });
  });
  const { tokens } = await oauth.getToken(code); oauth.setCredentials(tokens);
  const all = loadCredentials(); all.gmail = { tokens }; saveCredentials(all); // save the token with only send permission
  console.log('Gmail authentication complete.');
}
export function gmailClient(config, credentials) {
  const oauth = new google.auth.OAuth2(config.gmail.client_id, config.gmail.client_secret, config.gmail.redirect_uri);
  oauth.setCredentials(credentials?.tokens || {});
  oauth.on('tokens', tokens => {
    try { const all = loadCredentials(); all.gmail = { ...(all.gmail || {}), tokens: { ...(all.gmail?.tokens || {}), ...tokens } }; saveCredentials(all); } catch (e) { console.error(`Warning: could not persist refreshed Gmail token: ${e.message}`); }
  });
  return { oauth, api: google.gmail({ version: 'v1', auth: oauth }) }; // create the gmail client used for sending messages
}
export async function refreshGmailToken(client) {
  const { credentials } = await client.oauth.refreshAccessToken();
  const all = loadCredentials();
  all.gmail = { ...(all.gmail || {}), tokens: { ...(all.gmail?.tokens || {}), ...credentials } };
  saveCredentials(all);
}

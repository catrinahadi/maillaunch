import crypto from 'node:crypto';
import { renderTemplate, encodeSubject } from '../template.js';
import { dailyCount, canSend } from '../limits.js';
import { appendLog, readState, writeState, loadCredentials, saveCredentials } from '../campaign/store.js';
import { gmailClient, refreshGmailToken } from '../auth/gmail.js';
import { microsoftToken, refreshMicrosoftToken } from '../auth/microsoft.js';
import { httpStatus, retryAfterAuth } from '../retry.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mimeMessage(to, subject, body) {
  const safe = s => String(s).replace(/[\r\n]+/g, ' '); // keep headers safe and single-line
  const message = [`To: ${safe(to)}`, `Subject: ${encodeSubject(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', body].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url'); // gmail expects url-safe base64 payloads
}
export { dailyCount, canSend };
function campaignId() { return `c_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`; } // create a unique campaign id for tracking
async function sendGmail(client, recipient, subject, body) {
  await client.api.users.messages.send({ userId: 'me', requestBody: { raw: mimeMessage(recipient, subject, body) } }); // post the encoded email to gmail
}
async function sendMicrosoft(config, creds, recipient, subject, body) {
  const result = await microsoftToken(config, creds.microsoft);
  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { authorization: `Bearer ${result.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: recipient } }] }, saveToSentItems: true }) });
  const updated = loadCredentials(); updated.microsoft = { ...(updated.microsoft || {}), cache: result.cache, username: result.account?.username || updated.microsoft?.username, homeAccountId: result.account?.homeAccountId || updated.microsoft?.homeAccountId }; saveCredentials(updated);
  if (!response.ok) { const text = await response.text(); const error = new Error(`HTTP ${response.status} - ${text.slice(0, 500)}`); error.status = response.status; throw error; }
}
function logEntry(status, campaign, recipient, name, extra = {}) { appendLog({ status, campaign_id: campaign, recipient, name: name || '', ...extra }); }
function retryable(error) { const status = httpStatus(error); return status !== 401 && status !== 403 && (status === 429 || !status || status >= 500); }
export async function runCampaign({ config, rows, emailColumn, subject, body, skippedRows = [], resumeId = null, onProgress = () => {}, dryRun = false }) {
  const state = readState(); let campaign;
  if (resumeId) {
    campaign = state.campaigns[resumeId]; if (!campaign) throw new Error(`Campaign not found: ${resumeId}`);
    if (campaign.status === 'completed') throw new Error(`Campaign ${resumeId} is already completed`);
  } else {
    const id = campaignId(); campaign = { id, provider: config.provider, created_at: new Date().toISOString(), status: 'running', email_column: emailColumn, subject, body, rows, results: rows.map((r, i) => ({ index: i, status: 'queued', attempts: 0 })), sent_count: 0 };
    state.campaigns[id] = campaign; writeState(state);
  }
  const id = campaign.id;
  if (!resumeId) {
    for (const row of skippedRows) {
      const recipient = row[emailColumn] || '';
      const name = row.name || row.first_name || row.full_name || '';
      logEntry('SKIPPED', id, recipient, name, { message: 'missing or invalid email address' });
    }
  }
  const creds = dryRun ? {} : loadCredentials();
  let gClient = null;
  const hasPendingRecipients = campaign.results.some(result => !['sent', 'skipped'].includes(result.status));
  if (!dryRun && hasPendingRecipients && config.provider === 'gmail') {
    if (!creds.gmail?.tokens) throw new Error('Gmail is not authenticated. Run: maillaunch auth gmail');
    gClient = gmailClient(config, creds.gmail);
  }
  if (!dryRun && hasPendingRecipients && config.provider === 'microsoft' && !creds.microsoft?.cache) throw new Error('Microsoft is not authenticated. Run: maillaunch auth microsoft');
  const maxAttempts = config.send.retry_failed ? config.send.retry_attempts + 1 : 1; // retry only when configured
  try {
    for (let i = 0; i < campaign.results.length; i++) {
      const result = campaign.results[i];
      if (result.status === 'sent' || result.status === 'skipped') continue; // skip already completed recipients
      const row = campaign.rows[i]; const recipient = row[emailColumn] || ''; const name = row.name || row.first_name || row.full_name || '';
      const liveState = readState();
      if (!canSend(liveState, config.daily_limit)) {
        campaign.status = 'paused_daily_limit'; liveState.campaigns[id] = campaign; writeState(liveState); logEntry('LIMIT_REACHED', id, recipient, name, { message: `Daily limit ${config.daily_limit} reached` }); onProgress({ campaignId: id, status: 'paused_daily_limit', index: i }); return { campaignId: id, status: campaign.status }; // stop cleanly once the daily cap is hit
      }
      const renderedSubject = renderTemplate(campaign.subject, row); const renderedBody = renderTemplate(campaign.body, row); // personalize each message before sending
      let sent = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        result.attempts = attempt;
        try {
          if (!dryRun) {
            const send = () => {
              if (config.provider === 'gmail') return sendGmail(gClient, recipient, renderedSubject, renderedBody);
              if (config.provider === 'microsoft') return sendMicrosoft(config, creds, recipient, renderedSubject, renderedBody);
              throw new Error(`Unsupported provider: ${config.provider}`);
            };
            const refreshToken = () => config.provider === 'gmail'
              ? refreshGmailToken(gClient)
              : refreshMicrosoftToken(config, creds.microsoft);
            await retryAfterAuth(send, refreshToken, error => {
              const maxRetries = Math.max(1, config.send.retry_attempts);
              logEntry('FAILED', id, recipient, name, { attempt, error: error.message });
              logEntry('RETRY', id, recipient, name, { attempt, max_retries: maxRetries, delay_seconds: 0, error: error.message, message: 'access token refreshed' });
            }); // refresh the token once and retry if the provider rejects it
          }
          result.status = 'sent'; result.sent_at = new Date().toISOString(); result.error = null;
          const date = result.sent_at.slice(0, 10); const updated = readState(); updated.sentByDate[date] = dailyCount(updated, date) + 1; writeState(updated); // increment the utc daily counter after each successful send
          // keep campaign update independent from daily counter update.
          const persisted = readState(); persisted.campaigns[id] = campaign; writeState(persisted);
          logEntry('SENT', id, recipient, name, { attempt, dry_run: dryRun }); sent = true; onProgress({ campaignId: id, status: 'sent', index: i, total: campaign.rows.length }); break;
        } catch (error) {
          result.error = error.message; logEntry('FAILED', id, recipient, name, { attempt, error: error.message }); // record the failure before deciding to retry
          if (httpStatus(error) === 401) throw new Error(`Authentication failed for ${config.provider}; re-authenticate and resume. ${error.message}`); // auth failures must stop the campaign if refresh did not recover
          if (attempt >= maxAttempts || !retryable(error)) break;
          const wait = Math.min(300, config.send.backoff_base_seconds * (2 ** (attempt - 1))); // use exponential backoff for retryable errors
          logEntry('RETRY', id, recipient, name, { attempt, max_retries: config.send.retry_attempts, next_attempt: attempt + 1, delay_seconds: wait, error: error.message });
          await sleep(wait * 1000); // wait before the next attempt
        }
      }
      if (!sent) result.status = 'failed';
      const current = readState(); current.campaigns[id] = campaign; writeState(current);
      if (i < campaign.results.length - 1 && result.status === 'sent') {
        const delay = Math.floor(Math.random() * (config.send.max_delay_seconds - config.send.min_delay_seconds + 1)) + config.send.min_delay_seconds; // randomize the pause to respect sending limits
        await sleep(delay * 1000); // wait before the next recipient
      }
    }
    campaign.status = campaign.results.every(r => ['sent', 'skipped'].includes(r.status)) ? 'completed' : 'completed_with_failures'; // mark the campaign final state
    const finalState = readState(); finalState.campaigns[id] = campaign; writeState(finalState);
    return { campaignId: id, status: campaign.status, sent: campaign.results.filter(r => r.status === 'sent').length, failed: campaign.results.filter(r => r.status === 'failed').length };
  } catch (error) {
    campaign.status = 'interrupted'; const current = readState(); current.campaigns[id] = campaign; writeState(current); throw error; // persist interrupted state so resume can continue later
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maillaunch-limit-test-'));
process.env.MAILLAUNCH_HOME = dataHome;
const { runCampaign } = await import('../src/sender/engine.js');
const { readState, readLog, saveCredentials, TOKEN_PATH } = await import('../src/campaign/store.js');

test('resumes after a daily-limit pause without repeating successful recipients', async t => {
  t.after(() => fs.rmSync(dataHome, { recursive: true, force: true }));
  const previousPassword = process.env.MAILLAUNCH_STORE_PASSWORD;
  process.env.MAILLAUNCH_STORE_PASSWORD = 'test-password';
  saveCredentials({ gmail: { tokens: { access_token: 'test-token' } } });
  if (previousPassword === undefined) delete process.env.MAILLAUNCH_STORE_PASSWORD;
  else process.env.MAILLAUNCH_STORE_PASSWORD = previousPassword;

  const config = {
    provider: 'gmail',
    daily_limit: 1,
    send: {
      min_delay_seconds: 0,
      max_delay_seconds: 0,
      retry_failed: false,
      retry_attempts: 0,
      backoff_base_seconds: 0
    }
  };

  const result = await runCampaign({
    config,
    rows: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
    emailColumn: 'email',
    subject: 'test',
    body: 'test',
    dryRun: true
  });

  const state = readState();
  const campaign = state.campaigns[result.campaignId];
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(result.status, 'paused_daily_limit');
  assert.equal(state.sentByDate[today], 1);
  assert.deepEqual(campaign.results.map(item => item.status), ['sent', 'queued']);
  assert.ok(readLog(today).some(line => line.includes('LIMIT_REACHED')));
  assert.ok(fs.existsSync(TOKEN_PATH));

  config.daily_limit = 2;
  const resumed = await runCampaign({
    config,
    rows: campaign.rows,
    emailColumn: campaign.email_column,
    subject: campaign.subject,
    body: campaign.body,
    resumeId: campaign.id,
    dryRun: true
  });

  const resumedState = readState();
  const sentEntries = readLog(today).filter(line => line.includes('] SENT'));
  assert.equal(resumed.status, 'completed');
  assert.equal(resumedState.sentByDate[today], 2);
  assert.deepEqual(resumedState.campaigns[campaign.id].results.map(item => item.status), ['sent', 'sent']);
  assert.equal(sentEntries.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maillaunch-log-test-'));
process.env.MAILLAUNCH_HOME = dataHome;
const { appendLog, formatLogEntry, LOG_PATH, readLog } = await import('../src/campaign/store.js');

test('formats send log entries with required tracking details', () => {
  assert.equal(formatLogEntry({
    timestamp: '2026-10-15T04:00:00.000Z',
    status: 'SENT',
    recipient: 'john@example.com',
    name: 'John Smith',
    campaign_id: 'c_20261015_001'
  }), '[2026-10-15T04:00:00.000Z] SENT      john@example.com (John Smith) | campaign: c_20261015_001');
});

test('formats retry details and keeps each log entry on one line', () => {
  assert.equal(formatLogEntry({
    timestamp: '2026-10-15T04:00:00.000Z',
    status: 'RETRY',
    recipient: 'john@example.com',
    name: 'John\nSmith',
    campaign_id: 'c_20261015_001',
    attempt: 1,
    max_retries: 2,
    delay_seconds: 120,
    error: 'HTTP 429 - Too Many Requests'
  }), '[2026-10-15T04:00:00.000Z] RETRY     john@example.com (John Smith) | campaign: c_20261015_001 | error: HTTP 429 - Too Many Requests | attempt 1/2 in 120s');
});

test('stores structured JSON lines and displays them in the requested readable format', t => {
  t.after(() => fs.rmSync(dataHome, { recursive: true, force: true }));
  appendLog({ status: 'SKIPPED', campaign_id: 'c_20261015_002', recipient: '', name: 'Sam', message: 'missing or invalid email address' });

  const [storedLine] = fs.readFileSync(LOG_PATH, 'utf8').trim().split(/\r?\n/);
  const storedEntry = JSON.parse(storedLine);
  assert.equal(storedEntry.status, 'SKIPPED');
  assert.match(storedEntry.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(readLog(storedEntry.timestamp.slice(0, 10))[0], formatLogEntry(storedEntry));
});

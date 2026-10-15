import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyCount, canSend } from '../src/limits.js';
import { httpStatus, retryAfterAuth, retryWithBackoff } from '../src/retry.js';

test('daily limit count and enforcement', () => { const state = { sentByDate: { '2026-10-13': 2 } }; assert.equal(dailyCount(state, '2026-10-13'), 2); assert.equal(canSend(state, 3, '2026-10-13'), true); assert.equal(canSend(state, 2, '2026-10-13'), false); });
test('retries transient errors with exponential backoff and succeeds', async () => { let calls = 0; const waits = []; const result = await retryWithBackoff(async () => { calls++; if (calls < 3) { const e = new Error('busy'); e.status = 429; throw e; } return 'ok'; }, { attempts: 3, baseSeconds: 2, sleepFn: async ms => waits.push(ms) }); assert.equal(result, 'ok'); assert.equal(calls, 3); assert.deepEqual(waits, [2000, 4000]); });
test('does not retry authorization errors', async () => { let calls = 0; await assert.rejects(() => retryWithBackoff(async () => { calls++; const e = new Error('forbidden'); e.status = 403; throw e; }, { attempts: 4, sleepFn: async () => {} }), /forbidden/); assert.equal(calls, 1); });
test('refreshes an expired token once and retries the send', async () => {
  let sendCalls = 0;
  let refreshCalls = 0;
  let retryLogged = false;
  const result = await retryAfterAuth(async () => {
    sendCalls++;
    if (sendCalls === 1) {
      const error = new Error('expired token');
      error.response = { status: 401 };
      throw error;
    }
    return 'sent';
  }, async () => { refreshCalls++; }, async () => { retryLogged = true; });

  assert.equal(result, 'sent');
  assert.equal(sendCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(retryLogged, true);
});
test('does not refresh when the send fails for a non-auth reason', async () => {
  let refreshCalls = 0;
  await assert.rejects(() => retryAfterAuth(async () => {
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }, async () => { refreshCalls++; }), /forbidden/);
  assert.equal(refreshCalls, 0);
});
test('reports refresh failure and does not retry the send', async () => {
  let sendCalls = 0;
  await assert.rejects(() => retryAfterAuth(async () => {
    sendCalls++;
    const error = new Error('expired token');
    error.status = 401;
    throw error;
  }, async () => { throw new Error('refresh rejected'); }), /re-authenticate and resume.*refresh rejected/);
  assert.equal(sendCalls, 1);
});
test('reads provider HTTP status from common error shapes', () => {
  assert.equal(httpStatus({ status: 401 }), 401);
  assert.equal(httpStatus({ response: { status: 403 } }), 403);
});

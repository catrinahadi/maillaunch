import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectEmailColumn, validateRecipients } from '../src/csv.js';

test('parses ordinary CSV', () => { assert.deepEqual(parseCsv('email,name\na@b.com,Ada\n')[0], { email: 'a@b.com', name: 'Ada' }); });
test('strips BOM', () => { assert.equal(parseCsv('\uFEFFemail,name\na@b.com,Ada')[0].email, 'a@b.com'); });
test('supports quoted commas and escaped quotes', () => { assert.equal(parseCsv('email,name\na@b.com,"Smith, Ada"')[0].name, 'Smith, Ada'); assert.equal(parseCsv('email,note\na@b.com,"say ""hi"""')[0].note, 'say "hi"'); });
test('ignores empty rows', () => { assert.equal(parseCsv('email,name\n\n\na@b.com,Ada\n,\n').length, 1); });
test('detects email column case-insensitively', () => { assert.equal(detectEmailColumn(['First Name', 'Work_Email']), 'Work_Email'); });
test('validates and returns invalid rows for skipped logging', () => { const r = validateRecipients(parseCsv('email,name\na@b.com,A\nnot-an-email,B')); assert.equal(r.rows.length, 1); assert.equal(r.skipped, 1); assert.equal(r.skippedRows[0].name, 'B'); });
test('returns invalid rows even when every address is invalid', () => { const r = validateRecipients(parseCsv('email,name\nnot-an-email,B')); assert.equal(r.rows.length, 0); assert.equal(r.skipped, 1); });

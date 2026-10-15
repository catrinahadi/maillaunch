import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, DB_PATH, LOG_PATH, TOKEN_PATH } from '../config.js';

export function ensureDataDir() { fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function atomicJson(file, value) {
  ensureDataDir(); const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file);
}
export function readState() { return readJson(DB_PATH, { campaigns: {}, sentByDate: {} }); }
export function writeState(state) { atomicJson(DB_PATH, state); }
export function formatLogEntry(entry) {
  const clean = value => String(value).replace(/[\r\n]+/g, ' ');
  const timestamp = clean(entry.timestamp || new Date().toISOString());
  const recipient = clean(entry.recipient || '(missing email)');
  const name = clean(entry.name || 'name unknown');
  const campaign = clean(entry.campaign_id || 'unknown');
  const details = [];
  if (entry.error) details.push(`error: ${clean(entry.error)}`);
  if (entry.attempt && entry.max_retries) details.push(`attempt ${entry.attempt}/${entry.max_retries} in ${entry.delay_seconds}s`);
  else if (entry.attempt) details.push(`attempt ${entry.attempt}`);
  if (entry.dry_run) details.push('dry run - not delivered');
  if (entry.message) details.push(clean(entry.message));
  return `[${timestamp}] ${String(entry.status).padEnd(9)} ${recipient} (${name}) | campaign: ${campaign}${details.length ? ` | ${details.join(' | ')}` : ''}`;
}
export function appendLog(entry) {
  ensureDataDir();
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() });
  fs.appendFileSync(LOG_PATH, line + '\n', { mode: 0o600 });
}
export function readLog(date = new Date().toISOString().slice(0, 10)) {
  ensureDataDir(); if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    if (line.startsWith(`[${date}`)) return [line];
    try {
      const entry = JSON.parse(line);
      return entry.timestamp?.startsWith(date) ? [formatLogEntry(entry)] : [];
    } catch {
      return [];
    }
  });
}
function encryptionKey() {
  const password = process.env.MAILLAUNCH_STORE_PASSWORD;
  if (!password) throw new Error('Set MAILLAUNCH_STORE_PASSWORD to encrypt/decrypt local OAuth credentials.');
  return crypto.scryptSync(password, 'maillaunch-local-credential-store-v1', 32);
}
export function saveCredentials(credentials) {
  ensureDataDir(); const key = encryptionKey(), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  const payload = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(payload), { mode: 0o600 });
}
export function loadCredentials() {
  if (!fs.existsSync(TOKEN_PATH)) return {};
  const payload = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  if (payload.version !== 1) throw new Error('Unsupported credential store version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
}
export { DATA_DIR, DB_PATH, LOG_PATH, TOKEN_PATH };

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

export const DATA_DIR = path.resolve(process.env.MAILLAUNCH_HOME || path.join(os.homedir(), '.maillaunch'));
export const DB_PATH = path.join(DATA_DIR, 'campaigns.sqlite.json');
export const LOG_PATH = path.join(DATA_DIR, 'send.log');
export const TOKEN_PATH = path.join(DATA_DIR, 'credentials.enc');

const defaults = {
  provider: 'gmail', daily_limit: 100,
  gmail: { client_id: '', client_secret: '', redirect_uri: 'http://localhost:53682/oauth/callback' },
  microsoft: { client_id: '', tenant_id: 'common' },
  send: { min_delay_seconds: 60, max_delay_seconds: 180, retry_failed: true, retry_attempts: 2, backoff_base_seconds: 2 }
};
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v;
  return out;
}
export function loadConfig(file = 'maillaunch.config.yaml') {
  let parsed = {};
  if (fs.existsSync(file)) parsed = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const cfg = merge(defaults, parsed);
  cfg.gmail.client_secret = process.env.MAILLAUNCH_GMAIL_CLIENT_SECRET || (cfg.gmail.client_secret.startsWith('set-via ') ? '' : cfg.gmail.client_secret);
  cfg.gmail.client_id = process.env.MAILLAUNCH_GMAIL_CLIENT_ID || cfg.gmail.client_id;
  cfg.microsoft.client_id = process.env.MAILLAUNCH_MICROSOFT_CLIENT_ID || cfg.microsoft.client_id;
  cfg.microsoft.tenant_id = process.env.MAILLAUNCH_MICROSOFT_TENANT_ID || cfg.microsoft.tenant_id;
  cfg.daily_limit = Number(cfg.daily_limit);
  cfg.send.min_delay_seconds = Number(cfg.send.min_delay_seconds);
  cfg.send.max_delay_seconds = Number(cfg.send.max_delay_seconds);
  cfg.send.retry_attempts = Number(cfg.send.retry_attempts);
  if (!Number.isInteger(cfg.daily_limit) || cfg.daily_limit < 1) throw new Error('daily_limit must be a positive integer');
  if (cfg.send.min_delay_seconds < 0 || cfg.send.max_delay_seconds < cfg.send.min_delay_seconds) throw new Error('Invalid send delay range');
  return cfg;
}

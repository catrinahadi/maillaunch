#!/usr/bin/env node
import fs from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { parseCsv, validateRecipients } from './csv.js';
import { authenticateGmail } from './auth/gmail.js';
import { authenticateMicrosoft } from './auth/microsoft.js';
import { readState, writeState, readLog } from './campaign/store.js';
import { runCampaign } from './sender/engine.js';

const program = new Command();
program.name('maillaunch').description('CLI email campaign sender for Gmail and Microsoft 365').version('1.0.0');
function configFor(opts) { return loadConfig(opts.config || 'maillaunch.config.yaml'); } // get the saved settings before a command starts
program.command('auth <provider>').description('Authenticate with gmail or microsoft').option('-c, --config <file>', 'Config file', 'maillaunch.config.yaml').action(async (provider, opts) => {
  const config = configFor(opts); if (provider === 'gmail') await authenticateGmail(config); else if (provider === 'microsoft') await authenticateMicrosoft(config); else throw new Error('Provider must be gmail or microsoft'); // pick the right login flow
});
program.command('send').description('Start a new campaign').requiredOption('--csv <file>', 'CSV recipient file').requiredOption('--subject <subject>', 'Email subject template').requiredOption('--body-file <file>', 'Plain-text body template').option('--provider <provider>', 'gmail or microsoft').option('--min-delay <seconds>', 'Minimum delay seconds', Number).option('--max-delay <seconds>', 'Maximum delay seconds', Number).option('-c, --config <file>', 'Config file', 'maillaunch.config.yaml').option('--dry-run', 'Validate and simulate without sending').action(async opts => {
  const config = configFor(opts); if (opts.provider) config.provider = opts.provider;
  if (!['gmail', 'microsoft'].includes(config.provider)) throw new Error('provider must be gmail or microsoft');
  if (opts.minDelay !== undefined) config.send.min_delay_seconds = opts.minDelay; if (opts.maxDelay !== undefined) config.send.max_delay_seconds = opts.maxDelay;
  if (config.send.min_delay_seconds < 0 || config.send.max_delay_seconds < config.send.min_delay_seconds) throw new Error('Invalid delay range');
  const text = fs.readFileSync(opts.csv, 'utf8'); const allRows = parseCsv(text); const { rows, emailColumn, skipped, skippedRows } = validateRecipients(allRows); // read the csv and drop bad rows
  const body = fs.readFileSync(opts.bodyFile, 'utf8'); if (skipped) console.warn(`Skipping ${skipped} rows with missing/invalid email addresses.`); // tell the user if some names/emails were skipped
  console.log(`Starting ${config.provider} campaign for ${rows.length} recipients (email column: ${emailColumn})${opts.dryRun ? ' [DRY RUN]' : ''}`); // show what is about to happen
  const result = await runCampaign({ config, rows, emailColumn, subject: opts.subject, body, skippedRows, dryRun: Boolean(opts.dryRun), onProgress: p => { if (p.status === 'sent') console.log(`[${p.index + 1}/${p.total}] sent`); } }); // start the real send loop and show progress
  console.log(JSON.stringify(result, null, 2));
});
program.command('resume').description('Resume the most recent interrupted/paused campaign').option('--id <campaignId>', 'Specific campaign ID').option('-c, --config <file>', 'Config file', 'maillaunch.config.yaml').action(async opts => {
  const config = configFor(opts); const state = readState();
  const candidates = Object.values(state.campaigns).filter(c => ['interrupted', 'paused_daily_limit', 'running', 'completed_with_failures'].includes(c.status)).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const campaign = opts.id ? state.campaigns[opts.id] : candidates[0]; if (!campaign) throw new Error('No resumable campaign found.');
  config.provider = campaign.provider; console.log(`Resuming campaign ${campaign.id}`);
  const result = await runCampaign({ config, rows: campaign.rows, emailColumn: campaign.email_column, subject: campaign.subject, body: campaign.body, resumeId: campaign.id, onProgress: p => { if (p.status === 'sent') console.log(`[${p.index + 1}/${p.total}] sent`); } }); console.log(JSON.stringify(result, null, 2));
});
program.command('status').description('Show today\'s send count and campaign queue').option('-c, --config <file>', 'Config file', 'maillaunch.config.yaml').action(opts => {
  const config = configFor(opts); const state = readState(); const today = new Date().toISOString().slice(0, 10); console.log(`Date (UTC): ${today}\nSent today: ${state.sentByDate[today] || 0}/${config.daily_limit}`);
  const campaigns = Object.values(state.campaigns); if (!campaigns.length) console.log('No campaigns yet.'); else for (const c of campaigns.sort((a,b) => b.created_at.localeCompare(a.created_at))) console.log(`${c.id}  ${c.status}  ${c.results.filter(r=>r.status==='sent').length}/${c.results.length} sent`);
});
program.command('log').description('Print today\'s structured send log').option('--date <YYYY-MM-DD>', 'UTC date to display').action(opts => {
  const entries = readLog(opts.date || new Date().toISOString().slice(0, 10)); if (!entries.length) { console.log('No log entries for that date.'); return; }
  for (const entry of entries) console.log(entry);
});
program.showHelpAfterError();
program.parseAsync(process.argv).catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });

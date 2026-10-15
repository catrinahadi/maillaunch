# MailLaunch

This project turns a browser-based email sender into a command-line tool for personalized campaigns through Gmail or Microsoft 365. It saves campaign progress so an interrupted campaign can be resumed.

## What you need

- Node.js 18 or later
- A Gmail OAuth app, a Microsoft Entra app, or both
- A terminal and a browser to sign in

## 1. Setup and first send

Install the dependencies from the project folder:

```powershell
npm install
```

Set the provider and client ID in `maillaunch.config.yaml`. Do not put a real client secret in that file. In PowerShell, set a password for the local encrypted token store and the Gmail secret:

```powershell
$env:MAILLAUNCH_STORE_PASSWORD = "choose-a-long-local-passphrase"
$env:MAILLAUNCH_GMAIL_CLIENT_SECRET = "your-google-client-secret"
```

These values stay available only in this PowerShell window. Set them again if you open a new one. For Microsoft, configure the client ID in the YAML file or set `MAILLAUNCH_MICROSOFT_CLIENT_ID`.

Sign in to Gmail:

```powershell
node src/main.js auth gmail
```

For Microsoft 365, use `node src/main.js auth microsoft` instead. After signing in, try a dry run first:

```powershell
node src/main.js send --provider gmail --csv examples/recipients.csv --subject "Hi {{first_name}}" --body-file examples/template.txt --dry-run
```

When you're ready to send, run the same command without `--dry-run`. It will email the addresses in the CSV, so check the file carefully first.

You can use `npm link` to install the `maillaunch` command, or keep running it as `node src/main.js`. By default, MailLaunch stores encrypted credentials, campaign state, and logs in `~/.maillaunch`. Set `MAILLAUNCH_HOME` if you want to use a different folder. Keep your store password safe; if you lose it, you will need to sign in again.

## Set up Gmail

1. Create a project in Google Cloud Console and enable the Gmail API.
2. Configure the OAuth consent screen. If the app is in Testing mode, add your Google account as a test user.
3. Create a **Web application** OAuth client. Add this authorized redirect URI: `http://localhost:53682/oauth/callback`.
4. Put the client ID in `gmail.client_id` or set `MAILLAUNCH_GMAIL_CLIENT_ID`. Set the client secret in `MAILLAUNCH_GMAIL_CLIENT_SECRET`.
5. Run `node src/main.js auth gmail` and approve access in your browser.

## Set up Microsoft 365

1. Register an app in Microsoft Entra ID and enable public-client authorization-code flow.
2. Add the delegated Microsoft Graph permissions `Mail.Send` and `User.Read`.
3. Set `microsoft.client_id` in the YAML file or use `MAILLAUNCH_MICROSOFT_CLIENT_ID`. Set `microsoft.tenant_id` or `MAILLAUNCH_MICROSOFT_TENANT_ID` if needed.
4. Configure the redirect URI `http://localhost:53683` in the app registration.
5. Run `node src/main.js auth microsoft` and open the authorization link printed in the terminal. If you change the port, set `MAILLAUNCH_MICROSOFT_REDIRECT_PORT` and update the app registration to match.

## CSV and email templates

The first row of the CSV contains the column names. MailLaunch looks for a column with `email` or `mail` in its name and uses it as the recipient address. You can use any other column in your subject or message with `{{column_name}}`. For example, `{{first_name}}` will be replaced with that row's first name.

Quoted commas and UTF-8 BOM files are supported. Rows with a missing or invalid email address are skipped and logged. If a template variable is missing from a row, its placeholder is left in the message so you can spot it.

For example, `examples/template.txt` could contain:

```text
Hi {{first_name}},

I wanted to reach out about {{company}}.

Best,
Your Name
```

## Commands

Run these from the project folder:

```powershell
node src/main.js auth gmail
node src/main.js auth microsoft
node src/main.js send --provider gmail --csv examples/recipients.csv --subject "Hi {{first_name}}" --body-file examples/template.txt --min-delay 60 --max-delay 180
node src/main.js send --provider gmail --csv examples/recipients.csv --subject "Hi {{first_name}}" --body-file examples/template.txt --dry-run
node src/main.js status
node src/main.js log
node src/main.js log --date 2026-10-13
node src/main.js resume
node src/main.js resume --id c_...
```

A dry run checks the CSV, fills in the templates, and exercises campaign saving without sending email. It still creates a campaign and counts simulated sends toward the local daily total. Use a separate `MAILLAUNCH_HOME` if you don't want a test to affect your usual campaign data.

## How it works

- Campaigns and each recipient's progress are saved locally. When you resume, recipients already marked as sent are skipped.
- The daily limit is checked before each recipient. The counter uses UTC dates and includes dry-run sends.
- Every send attempt is recorded in `send.log` as a structured JSONL entry. Use `node src/main.js log` to view readable entries.
- Temporary errors such as rate limits, network problems, and server errors are retried with exponential backoff. On a 401, MailLaunch refreshes the token and retries once. If that fails, it asks you to sign in again.
- A random delay between the configured minimum and maximum is used between successful sends.

## 2. How to run tests

```powershell
npm test
```

The tests run locally and do not send email.

## 3. Design choices

I chose Node.js 18 because it is the language I'm most comfortable with, so I could focus on building and testing the campaign features instead of spending time learning a new stack. It also has built-in `fetch`, which keeps the API calls simple and avoids adding another HTTP library.

Tokens are encrypted on this computer with AES-256-GCM. The encryption key is derived from `MAILLAUNCH_STORE_PASSWORD`, so the tokens are not kept as plain text. I used a local JSON file for campaign state to keep setup simple; the tradeoff is that simultaneous MailLaunch processes are not coordinated safely.

## 4. What I'd improve next

While working on MailLaunch, I found that it can be difficult to spot a problem in a personalized message or CSV before a campaign starts. I’d add a preview and clearer CSV checks to make that safer. I’d also spend more time testing what happens if sending is interrupted, and test both providers more thoroughly with test accounts.

import { database } from './database.js';
import { sendStaffAlert } from './notifications.js';

export type ErrorSource = 'server' | 'client';

const keepRows = 1000;
const alertIntervalMs = 15 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

const insertError = database.prepare('INSERT INTO error_log (source, message, detail, path, user_agent) VALUES (?, ?, ?, ?, ?)');
const pruneErrors = database.prepare('DELETE FROM error_log WHERE id <= (SELECT MAX(id) FROM error_log) - ?');

// Saves an error for the admin Health page. Never throws: logging must not break the request that failed.
export function recordError(source: ErrorSource, message: string, detail = '', path = '', userAgent = ''): void {
  try {
    insertError.run(source, message.slice(0, 500), detail.slice(0, 4000), path.slice(0, 300), userAgent.slice(0, 300));
    pruneErrors.run(keepRows);
  } catch (error) {
    console.error('Could not record an error:', error);
  }
}

// Texts the company phone (STAFF_SMS_NUMBER) and emails ALERT_EMAIL about a serious server problem,
// at most once per 15 minutes for the same kind of problem so a crash loop does not flood the phone.
export async function alertOperators(key: string, text: string): Promise<void> {
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < alertIntervalMs) return;
  lastAlertAt.set(key, now);
  const jobs: Array<Promise<unknown>> = [sendStaffAlert(`Website problem: ${text}`)];
  const { RESEND_API_KEY: apiKey, RESEND_FROM_EMAIL: from, ALERT_EMAIL: to } = process.env;
  if (apiKey && from && to) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject: 'Project X website problem',
        text: `${text}\n\nTime: ${new Date().toISOString()}\nSee the admin Health page for details.`,
      }),
    }).catch(() => undefined));
  }
  await Promise.allSettled(jobs);
}

// Reset between tests.
export function resetAlertThrottle(): void {
  lastAlertAt.clear();
}

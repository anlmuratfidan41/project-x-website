import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertOperators, resetAlertThrottle } from '../src/monitoring.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAlertThrottle();
});

describe('operator alerts', () => {
  it('texts and emails once, then stays quiet for the same problem for 15 minutes', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15550001111');
    vi.stubEnv('STAFF_SMS_NUMBER', '+12024603027');
    vi.stubEnv('RESEND_API_KEY', 'key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Project X <alerts@example.com>');
    vi.stubEnv('ALERT_EMAIL', 'owner@example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await alertOperators('crash', 'the server crashed');
    await alertOperators('crash', 'the server crashed again');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('api.twilio.com'))).toBe(true);
    expect(urls.some((url) => url.includes('api.resend.com'))).toBe(true);
    const sms = new URLSearchParams(fetchMock.mock.calls.find((call) => String(call[0]).includes('twilio'))![1].body as URLSearchParams);
    expect(sms.get('Body')).toBe('Project X: Website problem: the server crashed');

    // A different problem is still reported.
    await alertOperators('health-db', 'the database is not responding.');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

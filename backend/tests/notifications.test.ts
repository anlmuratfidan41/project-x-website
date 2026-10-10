import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMeetingForSms, sendCustomerSms, sendNotifications, sendQuoteEmail, sendStaffAlert, toE164 } from '../src/notifications.js';

const request = {
  name: '<Kai & Co>',
  email: 'customer@example.com',
  phone: '',
  smsConsent: false,
  projectType: 'Water damage restoration',
  propertyAddress: '1200 Example Street NW, Washington, DC',
  preferredMeeting: 'Weekday mornings',
  idealStart: '',
  message: 'Water affected drywall in the basement.',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('customer request notifications', () => {
  it('sends a thank-you email with request details using the configured sender', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Project X <requests@example.com>');
    vi.stubEnv('RESEND_REPLY_TO_EMAIL', 'office@example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendNotifications(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string[];
      subject: string;
      reply_to: string;
      text: string;
      html: string;
    };
    expect(payload.to).toEqual([request.email]);
    expect(payload.subject).toContain('Thank you');
    expect(payload.reply_to).toBe('office@example.com');
    expect(payload.text).toContain(request.propertyAddress);
    expect(payload.html).toContain('&lt;Kai &amp; Co&gt;');
    expect(payload.html).toContain('Request summary');
  });

  it('formats phone numbers for Twilio and sends staff alerts to the company number', async () => {
    expect(toE164('(202) 460-3027')).toBe('+12024603027');
    expect(toE164('1 202 460 3027')).toBe('+12024603027');
    expect(toE164('+90 530 890 99 41')).toBe('+905308909941');
    expect(toE164('12345')).toBeNull();

    vi.stubEnv('STAFF_SMS_NUMBER', '+12024603027');
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    expect(await sendStaffAlert('New request')).toBe('not_configured');

    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');
    vi.stubEnv('TWILIO_FROM_NUMBER', '+15550001111');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendStaffAlert('New request from Taylor')).toBe('sent');
    expect(await sendCustomerSms('202-555-0199', 'Your meeting moved.')).toBe('sent');
    const staffBody = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect(staffBody.get('To')).toBe('+12024603027');
    expect(staffBody.get('Body')).toBe('Project X: New request from Taylor');
    const customerBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as URLSearchParams);
    expect(customerBody.get('To')).toBe('+12025550199');
    expect(customerBody.get('Body')).toContain('Reply STOP to opt out.');
    expect(formatMeetingForSms('2026-10-09T14:30')).toBe('Fri, Oct 9 at 2:30 PM');
  });

  it('includes the email confirmation link when one is provided', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Project X <requests@example.com>');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const link = 'http://localhost:5173/pages/step-1-request.html?verify=abc&x=1';

    await sendNotifications(request, link);

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { subject: string; text: string; html: string };
    expect(payload.subject).toContain('confirm your email');
    expect(payload.text).toContain(link);
    expect(payload.html).toContain('href="http://localhost:5173/pages/step-1-request.html?verify=abc&amp;x=1"');
  });

  it('does not attempt email delivery until Resend is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM_EMAIL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await sendNotifications(request);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a quote email with itemized labor, tax, and total', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Project X <quotes@example.com>');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendQuoteEmail({
      quoteNumber: 'PXQ-2026-ABCD1234',
      customerName: 'Taylor Morgan',
      customerEmail: 'customer@example.com',
      projectType: 'Interior rebuild',
      propertyAddress: '1200 Example Street NW',
      lines: [{ type: 'labor', description: 'Carpenter labor', quantity: 2, unit: 'hour', unitCost: 30, unitPrice: 40, lineCost: 60, lineTotal: 80 }],
      materialSubtotal: 0,
      laborSubtotal: 80,
      otherSubtotal: 0,
      subtotal: 80,
      taxPercent: 6,
      taxAmount: 4.8,
      total: 84.8,
      note: 'Estimate subject to site review.',
      quoteUrl: 'http://localhost:5173/pages/step-2-quote.html?quote=test-token',
      senderName: 'Jordan <Lee>',
    });

    expect(result).toBe('sent');
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { from: string; subject: string; text: string; html: string };
    expect(payload.from).toBe('Project X Contractors <quotes@example.com>');
    expect(payload.text).toContain('Sincerely,\nJordan <Lee>\nProject X Contractors');
    expect(payload.html).toContain('<strong>Jordan &lt;Lee&gt;</strong>');
    expect(payload.html).toContain('src="http://localhost:5173/assets/logo.png"');
    expect(payload.subject).toContain('$84.80');
    expect(payload.text).toContain('Carpenter labor');
    expect(payload.text).toContain('Tax (6%)');
    expect(payload.html).toContain('$84.80');
    expect(payload.html).toContain('TOTAL');
  });
});

import type { ProjectRequestInput } from './schema.js';

export type RequestedMaterial = { name: string; quantity: number; unit: string };
export type QuoteLine = {
  type: 'material' | 'labor' | 'other';
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  unitPrice: number;
  lineCost: number;
  lineTotal: number;
  imageUrl?: string;
};
export type CustomerQuote = {
  quoteNumber: string;
  customerName: string;
  customerEmail: string;
  projectType: string;
  propertyAddress: string;
  lines: QuoteLine[];
  materialSubtotal: number;
  laborSubtotal: number;
  otherSubtotal: number;
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  note: string;
  quoteUrl: string;
  senderName?: string;
};

export const companyName = 'Project X Contractors';

// Quotes always show the company as the sender name, whatever display name RESEND_FROM_EMAIL carries.
export function companyFromAddress(configured: string): string {
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  return `${companyName} <${address}>`;
}

export async function sendNotifications(request: ProjectRequestInput, verifyUrl?: string): Promise<void> {
  const jobs: Promise<void>[] = [];

  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    jobs.push(sendEmail(request, verifyUrl));
  } else if (verifyUrl && process.env.NODE_ENV !== 'production') {
    // Without Resend the customer never gets the link, so print it for local testing.
    console.info(`[dev] Email confirmation link for ${request.email}: ${verifyUrl}`);
  }
  if (request.smsConsent && request.phone) {
    jobs.push(sendCustomerSms(request.phone, 'Project X received your project request. Our team will follow up soon.').then(() => undefined));
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') console.warn('A request notification could not be delivered.');
  }
}

async function sendEmail(request: ProjectRequestInput, verifyUrl?: string): Promise<void> {
  const detailLines = [
    `Project type: ${request.projectType}`,
    `Property: ${request.propertyAddress}`,
    ...(request.preferredMeeting ? [`Preferred site meeting: ${request.preferredMeeting}`] : []),
    ...(request.idealStart ? [`Ideal start date: ${request.idealStart}`] : []),
  ];
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
  const safeName = escapeHtml(request.name);
  const htmlDetails = detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_FROM_EMAIL;
  const verifyText = verifyUrl ? `Please confirm your email to continue: ${verifyUrl}\n(The link is valid for 48 hours.)\n\n` : '';
  const verifyHtml = verifyUrl
    ? `<p style="margin:0 0 14px;line-height:1.6"><strong>Please confirm your email to continue.</strong> We schedule your site meeting once your email is confirmed.</p><p style="margin:0 0 18px"><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:13px 20px;background:#176d7f;color:#fff;text-decoration:none;font-weight:bold;font-size:13px">Confirm my email</a></p><p style="margin:0 0 14px;color:#65777c;font-size:12px;line-height:1.6">The link is valid for 48 hours. If you did not send this request, you can ignore this email.</p>`
    : '';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [request.email],
      reply_to: replyTo,
      subject: verifyUrl ? 'Thank you — please confirm your email for your Project X request' : 'Thank you — Project X received your request',
      text: `Hi ${request.name},\n\nThank you for contacting Project X Contractors. We received your project request. Our team will review the details and follow up with you about next steps and scheduling.\n\n${verifyText}${detailLines.join('\n')}\n\nThis email confirms receipt only; it is not a project estimate or agreement. Reply to this email if you would like to add information.\n\nProject X Contractors`,
      html: `<div style="margin:0;background:#f3f7f7;padding:32px 16px;font-family:Arial,sans-serif;color:#20343a"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dce6e5"><div style="padding:24px 28px;background:#12313a;color:#fff"><p style="margin:0;color:#85d7e8;font-size:11px;font-weight:bold;letter-spacing:2px">PROJECT X CONTRACTORS</p><h1 style="margin:12px 0 0;font-size:24px">Thank you, ${safeName}.</h1></div><div style="padding:26px 28px"><p style="margin:0 0 14px;line-height:1.6">We have received your project request. Our team will review the details and follow up with you about next steps and scheduling.</p>${verifyHtml}<h2 style="margin:22px 0 10px;font-size:15px">Request summary</h2><ul style="padding-left:20px;line-height:1.8">${htmlDetails}</ul><p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e3ebea;color:#65777c;font-size:12px;line-height:1.6">This email confirms receipt only; it is not a project estimate or agreement. Reply to this email if you would like to add information.</p></div></div></div>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
}

export type SmsResult = 'sent' | 'not_configured' | 'failed' | 'no_consent';

// Twilio needs E.164. Ten-digit numbers are treated as US (+1); numbers typed with + keep their country code.
export function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export async function sendSmsMessage(to: string, body: string): Promise<SmsResult> {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_FROM_NUMBER: from } = process.env;
  if (!accountSid || !authToken || !from) return 'not_configured';
  const number = toE164(to);
  if (!number) return 'failed';
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: number, Body: body }),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

// Customer texts always carry the opt-out line the carrier rules require.
export function sendCustomerSms(phone: string, body: string): Promise<SmsResult> {
  return sendSmsMessage(phone, `${body} Reply STOP to opt out.`);
}

// Alerts for the business itself go to STAFF_SMS_NUMBER (the company phone).
export async function sendStaffAlert(body: string): Promise<SmsResult> {
  const staffNumber = process.env.STAFF_SMS_NUMBER;
  if (!staffNumber) return 'not_configured';
  const result = await sendSmsMessage(staffNumber, `Project X: ${body}`);
  if (result === 'failed') console.warn('A staff SMS alert could not be delivered.');
  return result;
}

// "2026-10-09T14:30" → "Fri, Oct 9 at 2:30 PM" (the stored value is local wall time, so format it without shifting zones).
export function formatMeetingForSms(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return value;
  const [, y, m, d, h, min] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(min ?? 0)));
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return h === undefined ? day : `${day} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`;
}

export async function sendMaterialFollowupEmail(
  customer: Pick<ProjectRequestInput, 'name' | 'email' | 'projectType' | 'propertyAddress'>,
  items: RequestedMaterial[],
  message: string,
): Promise<'sent' | 'not_configured' | 'failed'> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return 'not_configured';
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
  const htmlItems = items.map((item) => `<li>${escapeHtml(item.name)} — ${item.quantity} ${escapeHtml(item.unit)}</li>`).join('');
  const textItems = items.map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`).join('\n');
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_FROM_EMAIL;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [customer.email],
        reply_to: replyTo,
        subject: 'Project X — information needed for your project',
        text: `Hi ${customer.name},\n\nTo help us prepare your ${customer.projectType} project at ${customer.propertyAddress}, please review the materials or details below and reply to this email with any questions.\n\n${textItems}${message ? `\n\nNote from our team: ${message}` : ''}\n\nThank you,\nProject X Contractors`,
        html: `<div style="margin:0;background:#f3f7f7;padding:32px 16px;font-family:Arial,sans-serif;color:#20343a"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dce6e5"><div style="padding:24px 28px;background:#12313a;color:#fff"><p style="margin:0;color:#85d7e8;font-size:11px;font-weight:bold;letter-spacing:2px">PROJECT X CONTRACTORS</p><h1 style="margin:12px 0 0;font-size:22px">A few details for your project</h1></div><div style="padding:26px 28px"><p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(customer.name)}, to help us prepare your project, please review the requested materials or details below and reply to this email with any questions.</p><p style="margin:0;color:#60747b;font-size:13px">${escapeHtml(customer.projectType)} · ${escapeHtml(customer.propertyAddress)}</p><ul style="padding-left:20px;line-height:1.9">${htmlItems}</ul>${message ? `<p style="padding:13px;background:#edf5f4;line-height:1.6">${escapeHtml(message)}</p>` : ''}<p style="margin:20px 0 0">Thank you,<br/>Project X Contractors</p></div></div></div>`,
      }),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function sendQuoteEmail(quote: CustomerQuote): Promise<'sent' | 'not_configured' | 'failed'> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return 'not_configured';
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
  const money = (amount: number) => `$${amount.toFixed(2)}`;
  const typeName = { material: 'Material', labor: 'Labor', other: 'Fee' } as const;
  const rows = quote.lines.map((line) => `<tr><td style="padding:10px 8px;border-bottom:1px solid #e5eceb">${line.imageUrl ? `<img src="${escapeHtml(new URL(line.imageUrl, quote.quoteUrl).toString())}" width="54" height="42" alt="" style="float:left;object-fit:cover;margin:0 10px 4px 0;border-radius:3px"/>` : ''}${escapeHtml(line.description)}<br/><small style="color:#74858a">${typeName[line.type]} · ${line.quantity} ${escapeHtml(line.unit)} × ${money(line.unitPrice)}</small></td><td style="padding:10px 8px;border-bottom:1px solid #e5eceb;text-align:right;white-space:nowrap">${money(line.lineTotal)}</td></tr>`).join('');
  const textLines = quote.lines.map((line) => `${line.description} (${typeName[line.type]}): ${line.quantity} ${line.unit} × ${money(line.unitPrice)} = ${money(line.lineTotal)}`).join('\n');
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_FROM_EMAIL;
  const logoUrl = escapeHtml(new URL('/assets/logo.png', quote.quoteUrl).toString());
  const senderName = quote.senderName?.trim() ?? '';
  const textSignature = `Sincerely,\n${senderName ? `${senderName}\n` : ''}${companyName}`;
  const htmlSignature = `<p style="margin:22px 0 0;line-height:1.6">Sincerely,<br/>${senderName ? `<strong>${escapeHtml(senderName)}</strong><br/>` : ''}${companyName}</p>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: companyFromAddress(process.env.RESEND_FROM_EMAIL),
        to: [quote.customerEmail],
        reply_to: replyTo,
        subject: `Project X quote ${quote.quoteNumber} — ${money(quote.total)}`,
        text: `Hello ${quote.customerName},\n\nHere is the estimate for your ${quote.projectType} project at ${quote.propertyAddress}.\n\nQuote ${quote.quoteNumber}\n${textLines}\n\nMaterials: ${money(quote.materialSubtotal)}\nLabor: ${money(quote.laborSubtotal)}\nOther: ${money(quote.otherSubtotal)}\nSubtotal: ${money(quote.subtotal)}\nTax (${quote.taxPercent}%): ${money(quote.taxAmount)}\nTOTAL: ${money(quote.total)}${quote.note ? `\n\nNote: ${quote.note}` : ''}\n\nView your itemized quote: ${quote.quoteUrl}\n\nThis estimate is subject to site verification and written approval. It is not a final invoice or request for payment. Reply to this email with questions.\n\n${textSignature}`,
        html: `<div style="margin:0;background:#f3f7f7;padding:32px 16px;font-family:Arial,sans-serif;color:#20343a"><div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #dce6e5"><div style="padding:24px 28px;background:#12313a;color:#fff"><img src="${logoUrl}" alt="Project X Contractors" height="44" style="display:block;height:44px;width:auto;margin:0 0 12px"/><p style="margin:0;color:#85d7e8;font-size:11px;font-weight:bold;letter-spacing:2px">PROJECT X CONTRACTORS</p><h1 style="margin:12px 0 5px;font-size:23px">Project estimate</h1><p style="margin:0;color:#c2dadd;font-size:12px">${escapeHtml(quote.quoteNumber)}</p></div><div style="padding:24px 28px"><p style="line-height:1.6">Hello ${escapeHtml(quote.customerName)}, here is the estimate for your project.</p><p style="color:#60747b;font-size:13px;line-height:1.6">${escapeHtml(quote.projectType)}<br/>${escapeHtml(quote.propertyAddress)}</p><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="padding:9px 8px;text-align:left;border-bottom:2px solid #cbd8d6">Description</th><th style="padding:9px 8px;text-align:right;border-bottom:2px solid #cbd8d6">Amount</th></tr></thead><tbody>${rows}</tbody></table><table style="width:100%;max-width:330px;margin:14px 0 14px auto;border-collapse:collapse;font-size:13px"><tr><td style="padding:5px">Materials</td><td style="padding:5px;text-align:right">${money(quote.materialSubtotal)}</td></tr><tr><td style="padding:5px">Labor</td><td style="padding:5px;text-align:right">${money(quote.laborSubtotal)}</td></tr><tr><td style="padding:5px">Other</td><td style="padding:5px;text-align:right">${money(quote.otherSubtotal)}</td></tr><tr><td style="padding:5px;border-top:1px solid #dce6e5">Subtotal</td><td style="padding:5px;text-align:right;border-top:1px solid #dce6e5">${money(quote.subtotal)}</td></tr><tr><td style="padding:5px">Tax (${quote.taxPercent}%)</td><td style="padding:5px;text-align:right">${money(quote.taxAmount)}</td></tr><tr><td style="padding:12px 5px;border-top:2px solid #176d7f;font-weight:bold;font-size:16px">TOTAL</td><td style="padding:12px 5px;border-top:2px solid #176d7f;text-align:right;font-weight:bold;font-size:16px">${money(quote.total)}</td></tr></table>${quote.note ? `<p style="padding:12px;background:#edf5f4;font-size:12px;line-height:1.6">${escapeHtml(quote.note)}</p>` : ''}<p style="margin:22px 0"><a href="${escapeHtml(quote.quoteUrl)}" style="display:inline-block;padding:13px 18px;background:#176d7f;color:#fff;text-decoration:none;font-weight:bold;font-size:12px">View itemized quote</a></p>${htmlSignature}<p style="margin-top:22px;padding-top:14px;border-top:1px solid #e3ebea;color:#65777c;font-size:11px;line-height:1.6">This estimate is subject to site verification and written approval. It is not a final invoice or request for payment. Reply to this email with questions.</p></div></div></div>`,
      }),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { database } from './database.js';
import { alertOperators, recordError } from './monitoring.js';
import {
  formatMeetingForSms, sendCustomerSms, sendMaterialFollowupEmail, sendNotifications, sendQuoteEmail, sendStaffAlert,
  type QuoteLine, type SmsResult,
} from './notifications.js';
import {
  applicationSchema, applicationStatusSchema, clientErrorSchema, inventoryMovementSchema, loginSchema, materialFollowupSchema, materialSchema,
  calendarEventSchema, expenseSchema, financeQuerySchema, materialUpdateSchema, meetingUpdateSchema, maxResumeBytes, paymentSchema, voidSchema, quoteApprovalSchema, quoteSchema, requestSchema, statusSchema, verifyRequestSchema,
} from './schema.js';

const sessionCookie = 'projectx_session';
const sessionDurationMs = 1000 * 60 * 60 * 8;
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
// Picks the newest quote of the outer `requests` row; used wherever a project is valued by its latest quote.
const latestQuoteSubquery = 'SELECT id FROM quotes WHERE quotes.request_id = requests.id ORDER BY created_at DESC, rowid DESC LIMIT 1';
// Money actually kept for the outer `requests` row: payments minus refunds, ignoring voided entries.
const netPaidSql = `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0)
  FROM payments WHERE payments.request_id = requests.id AND payments.voided_at IS NULL`;
const roundMoney = (value: number | null | undefined) => Math.round((value ?? 0) * 100) / 100;

function readCookie(request: Request, name: string): string | undefined {
  const pair = request.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function materialImage(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes('tile')) return '/assets/tile.jpg';
  if (normalized.includes('lumber') || normalized.includes('fastener')) return '/assets/framing.jpg';
  if (normalized.includes('drywall') || normalized.includes('paint')) return '/assets/interior.jpg';
  if (normalized.includes('equipment')) return '/assets/blueprint.jpg';
  return '/assets/interior.jpg';
}

function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const token = readCookie(request, sessionCookie);
  if (!token) {
    response.status(401).json({ error: 'Sign in required.' });
    return;
  }
  const session = database.prepare(`
    SELECT users.id AS userId, users.email AS email, users.role AS role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as { userId: string; email: string; role: string } | undefined;
  if (!session) {
    response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
    response.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }
  response.locals.user = session;
  next();
}

export const app = express();
app.disable('x-powered-by');
// Behind the host's HTTPS proxy, trust its X-Forwarded-For so rate limits see each visitor's real IP.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// One public address: www.projectx.build → projectx.build (permanent), so search engines see a single site.
const canonicalHost = new URL(frontendOrigin).host;
app.use((request, response, next) => {
  if (process.env.SERVE_FRONTEND === 'true' && request.get('host') === `www.${canonicalHost}`) {
    response.redirect(301, `${frontendOrigin.replace(/\/+$/, '')}${request.originalUrl}`);
    return;
  }
  next();
});
// When this server also serves the website, the pages need Google Fonts, the Google Maps embed and inline styles.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: ['https://www.google.com'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null,
    },
  },
}));
app.use(cors({ origin: frontendOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type'] }));
// Job applications carry a base64 resume, so they get their own larger body limit on the route.
const smallJson = express.json({ limit: '32kb' });
app.use((request, response, next) => (request.path === '/api/applications' ? next() : smallJson(request, response, next)));
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && origin && origin !== frontendOrigin) {
    response.status(403).json({ error: 'Cross-origin request rejected.' });
    return;
  }
  next();
});

// Rate limits protect public forms and login; the test suite turns them off with DISABLE_RATE_LIMITS.
const limiter = (windowMs: number, limit: number) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => process.env.DISABLE_RATE_LIMITS === 'true',
});
const authLimiter = limiter(15 * 60 * 1000, 10);
const requestLimiter = limiter(60 * 60 * 1000, 10);
const verifyLimiter = limiter(15 * 60 * 1000, 30);
const verifyLinkDurationMs = 1000 * 60 * 60 * 48;
const applicationLimiter = limiter(60 * 60 * 1000, 5);

// Used by the external uptime monitor: 200 only when the database answers too, 503 otherwise.
app.get('/api/health', (_request, response) => {
  try {
    database.prepare('SELECT 1').get();
    response.setHeader('Cache-Control', 'no-store');
    response.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  } catch (error) {
    recordError('server', 'Health check: database unavailable', error instanceof Error ? error.stack ?? error.message : String(error), '/api/health');
    void alertOperators('health-db', 'the database is not responding.');
    response.status(503).json({ status: 'error', error: 'Database unavailable.' });
  }
});

const clientErrorLimiter = limiter(15 * 60 * 1000, 30);

// Browser JavaScript errors from visitors, so broken pages show up on the Health page.
app.post('/api/client-errors', clientErrorLimiter, (request, response) => {
  const parsed = clientErrorSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid error report.' });
    return;
  }
  const report = parsed.data;
  recordError('client', report.message, report.stack, report.page, request.get('user-agent') ?? '');
  response.status(204).end();
});

app.get('/api/admin/errors', requireAuth, (_request, response) => {
  const errors = database.prepare(`
    SELECT id, source, message, detail, path, user_agent AS userAgent, created_at AS createdAt
    FROM error_log ORDER BY id DESC LIMIT 100
  `).all();
  const counts = database.prepare(`
    SELECT COALESCE(SUM(CASE WHEN source = 'server' THEN 1 ELSE 0 END), 0) AS server,
      COALESCE(SUM(CASE WHEN source = 'client' THEN 1 ELSE 0 END), 0) AS client
    FROM error_log WHERE created_at >= datetime('now', '-1 day')
  `).get();
  response.json({ errors, last24h: counts, uptimeSeconds: Math.round(process.uptime()) });
});

app.post('/api/admin/errors/clear', requireAuth, (_request, response) => {
  database.prepare('DELETE FROM error_log').run();
  response.json({ message: 'Error log cleared.' });
});

app.post('/api/requests', requestLimiter, async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Please check the request details.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const data = parsed.data;
  // The request stays unconfirmed until the customer opens the emailed link.
  const verifyToken = randomBytes(32).toString('base64url');
  database.prepare(`
    INSERT INTO requests (id, name, email, phone, project_type, property_address, preferred_meeting, ideal_start, message,
      verify_token_hash, verify_expires_at, sms_consent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), data.name, data.email, data.phone, data.projectType, data.propertyAddress, data.preferredMeeting,
    data.idealStart, data.message, hashToken(verifyToken), Date.now() + verifyLinkDurationMs, data.smsConsent && data.phone ? 1 : 0);
  const verifyUrl = new URL(`/contact?verify=${verifyToken}`, frontendOrigin).toString();
  void sendNotifications(data, verifyUrl);
  void sendStaffAlert(`New request from ${data.name} (${data.projectType}), ${data.propertyAddress}.${data.phone ? ` Phone ${data.phone}.` : ''}`);
  response.status(201).json({
    message: 'Your request has been received. Check your email and open the confirmation link to continue.',
    verificationRequired: true,
  });
});

app.post('/api/requests/verify', verifyLimiter, (request, response) => {
  const parsed = verifyRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
    return;
  }
  const row = database.prepare(`
    SELECT id, name, project_type AS projectType, email_verified_at AS verifiedAt, verify_expires_at AS expiresAt
    FROM requests WHERE verify_token_hash = ?
  `).get(hashToken(parsed.data.token)) as { id: string; name: string; projectType: string; verifiedAt: string | null; expiresAt: number | null } | undefined;
  if (!row || (!row.verifiedAt && (row.expiresAt ?? 0) < Date.now())) {
    response.status(400).json({ error: 'This confirmation link is invalid or has expired. Please send your request again.' });
    return;
  }
  if (!row.verifiedAt) {
    database.prepare("UPDATE requests SET email_verified_at = datetime('now') WHERE id = ?").run(row.id);
  }
  response.json({
    message: row.verifiedAt ? 'Your email was already confirmed.' : 'Your email is confirmed.',
    name: row.name,
    projectType: row.projectType,
    alreadyVerified: Boolean(row.verifiedAt),
  });
});

app.post('/api/applications', applicationLimiter, express.json({ limit: '8mb' }), (request, response) => {
  const parsed = applicationSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Please check your application details.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const application = parsed.data;
  let resume: Buffer | null = null;
  if (application.resume) {
    resume = Buffer.from(application.resume.data, 'base64');
    if (resume.length > maxResumeBytes || resume.subarray(0, 5).toString('latin1') !== '%PDF-') {
      response.status(400).json({ error: 'Resume must be a PDF file of 5 MB or less.' });
      return;
    }
  }
  database.prepare(`
    INSERT INTO applications (id, name, email, phone, position, message, resume_name, resume_pdf)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), application.name, application.email, application.phone, application.position,
    application.message, application.resume?.name ?? null, resume);
  void sendStaffAlert(`New job application from ${application.name} for ${application.position}.`);
  response.status(201).json({ message: 'Thank you — your application has been received.' });
});

app.get('/api/admin/applications', requireAuth, (_request, response) => {
  const applications = database.prepare(`
    SELECT id, name, email, phone, position, message, status, created_at AS createdAt,
      resume_name AS resumeName, resume_pdf IS NOT NULL AS hasResume
    FROM applications ORDER BY created_at DESC
  `).all() as Array<Record<string, unknown> & { hasResume: number }>;
  response.json({ applications: applications.map((item) => ({ ...item, hasResume: Boolean(item.hasResume) })) });
});

app.get('/api/admin/applications/:id/resume', requireAuth, (request, response) => {
  const row = database.prepare('SELECT resume_name AS name, resume_pdf AS pdf FROM applications WHERE id = ?')
    .get(request.params.id) as { name: string | null; pdf: Buffer | null } | undefined;
  if (!row?.pdf) {
    response.status(404).json({ error: 'Resume not found.' });
    return;
  }
  const safeName = (row.name ?? 'resume.pdf').replace(/[^\w.\- ]+/g, '_');
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}"`);
  response.send(row.pdf);
});

app.patch('/api/admin/applications/:id', requireAuth, (request, response) => {
  const parsed = applicationStatusSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid application status.' });
    return;
  }
  const result = database.prepare('UPDATE applications SET status = ? WHERE id = ?').run(parsed.data.status, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Application not found.' });
    return;
  }
  response.json({ message: 'Application updated.' });
});

app.post('/api/auth/login', authLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Enter a valid email and password.' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = database.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ? COLLATE NOCASE').get(email) as
    { id: string; email: string; password_hash: string; role: string } | undefined;
  const validPassword = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
  if (!user || !validPassword) {
    response.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  const token = randomBytes(32).toString('base64url');
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), user.id, Date.now() + sessionDurationMs);
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: sessionDurationMs,
  });
  response.json({ user: { email: user.email, role: user.role } });
});

app.get('/api/auth/me', (request, response) => {
  const token = readCookie(request, sessionCookie);
  if (!token) {
    response.json({ user: null });
    return;
  }
  const user = database.prepare(`
    SELECT users.email AS email, users.role AS role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as { email: string; role: string } | undefined;
  if (!user) {
    response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
  }
  response.json({ user: user ?? null });
});
app.post('/api/auth/logout', (request, response) => {
  const token = readCookie(request, sessionCookie);
  if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
  response.status(204).end();
});

app.get('/api/admin/requests', requireAuth, (_request, response) => {
  const rows = database.prepare(`
    SELECT requests.id, requests.name, requests.email, requests.phone, requests.project_type AS projectType,
      requests.property_address AS propertyAddress, requests.preferred_meeting AS preferredMeeting,
      requests.ideal_start AS idealStart, requests.message, requests.status, requests.created_at AS createdAt,
      requests.email_verified_at AS emailVerifiedAt, requests.meeting_status AS meetingStatus, requests.meeting_note AS meetingNote,
      (SELECT COUNT(*) FROM quotes WHERE quotes.request_id = requests.id) AS quoteCount,
      latest.id AS lastQuoteId, latest.quote_number AS lastQuoteNumber, latest.total AS lastQuoteTotal,
      latest.delivery_status AS lastQuoteDelivery, latest.created_at AS lastQuoteCreatedAt,
      latest.created_by AS lastQuoteCreatedBy, latest.approval_status AS lastQuoteApproval,
      (${netPaidSql}) AS paidTotal
    FROM requests
    LEFT JOIN quotes AS latest ON latest.id = (${latestQuoteSubquery})
    ORDER BY requests.created_at DESC
  `).all() as Array<Record<string, unknown> & { lastQuoteId: string | null }>;
  const requests = rows.map(({ lastQuoteId, lastQuoteNumber, lastQuoteTotal, lastQuoteDelivery, lastQuoteCreatedAt, lastQuoteCreatedBy, lastQuoteApproval, ...item }) => ({
    ...item,
    lastQuote: lastQuoteId
      ? {
        id: lastQuoteId, quoteNumber: lastQuoteNumber, total: lastQuoteTotal, deliveryStatus: lastQuoteDelivery,
        createdAt: lastQuoteCreatedAt, createdBy: lastQuoteCreatedBy, approvalStatus: lastQuoteApproval,
      }
      : null,
  }));
  response.json({ requests });
});

app.get('/api/admin/dashboard', requireAuth, (_request, response) => {
  const requests = database.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new
    FROM requests
  `).get() as { total: number; new: number | null };
  const materials = database.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN unit_price = 0 THEN 1 ELSE 0 END) AS missingPrice,
      SUM(CASE WHEN stock_qty <= 2 THEN 1 ELSE 0 END) AS lowStock
    FROM materials WHERE archived_at IS NULL
  `).get() as { total: number; missingPrice: number | null; lowStock: number | null };
  // Each project counts once, valued at its most recent quote. Declined requests are left out of open money.
  const finance = database.prepare(`
    WITH project AS (
      SELECT requests.status AS status, latest.total AS quoteTotal, latest.approval_status AS approval,
        (${netPaidSql}) AS paid
      FROM requests LEFT JOIN quotes AS latest ON latest.id = (${latestQuoteSubquery})
    )
    SELECT COUNT(*) AS projects,
      SUM(CASE WHEN quoteTotal IS NOT NULL THEN 1 ELSE 0 END) AS quotedProjects,
      SUM(CASE WHEN status != 'declined' AND approval IN ('pending', 'approved') THEN quoteTotal ELSE 0 END) AS quotedValue,
      SUM(CASE WHEN status != 'declined' AND approval = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN status != 'declined' AND approval = 'pending' THEN quoteTotal ELSE 0 END) AS pendingValue,
      SUM(CASE WHEN approval = 'approved' THEN 1 ELSE 0 END) AS approvedCount,
      SUM(CASE WHEN approval = 'approved' THEN quoteTotal ELSE 0 END) AS approvedValue,
      SUM(CASE WHEN approval = 'approved' AND quoteTotal > paid THEN quoteTotal - paid ELSE 0 END) AS outstanding,
      SUM(paid) AS received
    FROM project
  `).get() as Record<string, number | null>;
  const expenses = database.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE voided_at IS NULL').get() as { total: number };
  response.json({
    requests: { total: requests.total, new: requests.new ?? 0 },
    materials: { total: materials.total, missingPrice: materials.missingPrice ?? 0, lowStock: materials.lowStock ?? 0 },
    finance: {
      projects: finance.projects ?? 0,
      quotedProjects: finance.quotedProjects ?? 0,
      quotedValue: roundMoney(finance.quotedValue),
      pending: { count: finance.pendingCount ?? 0, value: roundMoney(finance.pendingValue) },
      approved: { count: finance.approvedCount ?? 0, value: roundMoney(finance.approvedValue) },
      outstanding: roundMoney(finance.outstanding),
      received: roundMoney(finance.received),
      expenses: roundMoney(expenses.total),
      netProfit: roundMoney(roundMoney(finance.received) - roundMoney(expenses.total)),
    },
  });
});

app.patch('/api/admin/quotes/:id/approval', requireAuth, (request, response) => {
  const parsed = quoteApprovalSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid approval status.' });
    return;
  }
  const result = database.prepare(`
    UPDATE quotes SET approval_status = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE id = ?
  `).run(parsed.data.approvalStatus, parsed.data.approvalStatus, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Quote not found.' });
    return;
  }
  response.json({ message: 'Quote approval updated.' });
});

const paymentColumnsSql = `payments.id, payments.request_id AS requestId, payments.kind, payments.amount, payments.note,
  payments.recorded_by AS recordedBy, payments.received_at AS receivedAt, payments.voided_at AS voidedAt,
  payments.voided_by AS voidedBy, payments.void_reason AS voidReason`;
const netPaidForRequest = database.prepare(`
  SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS net
  FROM payments WHERE request_id = ? AND voided_at IS NULL
`);

app.get('/api/admin/requests/:id/payments', requireAuth, (request, response) => {
  const exists = database.prepare('SELECT id FROM requests WHERE id = ?').get(request.params.id);
  if (!exists) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }
  const payments = database.prepare(`SELECT ${paymentColumnsSql} FROM payments WHERE request_id = ? ORDER BY received_at DESC, rowid DESC`)
    .all(request.params.id);
  response.json({ payments, netPaid: roundMoney((netPaidForRequest.get(request.params.id) as { net: number }).net) });
});

app.post('/api/admin/requests/:id/payments', requireAuth, (request, response) => {
  const parsed = paymentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Enter an amount greater than zero.' });
    return;
  }
  const { kind, note } = parsed.data;
  const amount = roundMoney(parsed.data.amount);
  const save = database.transaction(() => {
    const exists = database.prepare('SELECT id FROM requests WHERE id = ?').get(request.params.id);
    if (!exists) return { status: 404, body: { error: 'Request not found.' } };
    const netPaid = roundMoney((netPaidForRequest.get(request.params.id) as { net: number }).net);
    if (kind === 'refund' && amount > netPaid) {
      return { status: 409, body: { error: `A refund cannot be more than the $${netPaid.toFixed(2)} received for this project.` } };
    }
    database.prepare('INSERT INTO payments (id, request_id, kind, amount, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), request.params.id, kind, amount, note, response.locals.user.email);
    return { status: 201, body: { message: kind === 'refund' ? 'Refund recorded.' : 'Payment recorded.' } };
  });
  const result = save();
  response.status(result.status).json(result.body);
});

// Voiding keeps the row (and who voided it, and why) so the payment history stays complete.
app.post('/api/admin/payments/:id/void', requireAuth, (request, response) => {
  const parsed = voidSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Give a short reason for voiding this entry.' });
    return;
  }
  const run = database.transaction(() => {
    const payment = database.prepare('SELECT request_id AS requestId, kind, amount, voided_at AS voidedAt FROM payments WHERE id = ?')
      .get(request.params.id) as { requestId: string; kind: string; amount: number; voidedAt: string | null } | undefined;
    if (!payment) return { status: 404, body: { error: 'Payment not found.' } };
    if (payment.voidedAt) return { status: 409, body: { error: 'This entry is already voided.' } };
    const netPaid = roundMoney((netPaidForRequest.get(payment.requestId) as { net: number }).net);
    if (payment.kind === 'payment' && roundMoney(netPaid - payment.amount) < 0) {
      return { status: 409, body: { error: 'Void the related refund first; otherwise refunds would exceed payments.' } };
    }
    database.prepare("UPDATE payments SET voided_at = datetime('now'), voided_by = ?, void_reason = ? WHERE id = ?")
      .run(response.locals.user.email, parsed.data.reason, request.params.id);
    return { status: 200, body: { message: 'Entry voided. It stays in the history.' } };
  });
  const result = run();
  response.status(result.status).json(result.body);
});

app.get('/api/admin/expenses', requireAuth, (request, response) => {
  const parsed = financeQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: 'Use dates in YYYY-MM-DD format.' });
    return;
  }
  const { from = '0000-01-01', to = '9999-12-31' } = parsed.data;
  const expenses = database.prepare(`
    SELECT expenses.id, expense_date AS expenseDate, category, description, paid_to AS paidTo, amount,
      request_id AS requestId, requests.name AS projectName, recorded_by AS recordedBy, expenses.created_at AS createdAt,
      voided_at AS voidedAt, voided_by AS voidedBy, void_reason AS voidReason
    FROM expenses LEFT JOIN requests ON requests.id = expenses.request_id
    WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC, expenses.created_at DESC
  `).all(from, to);
  response.json({ expenses });
});

app.post('/api/admin/expenses', requireAuth, (request, response) => {
  const parsed = expenseSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the expense date, category, description and amount.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const expense = parsed.data;
  if (expense.requestId && !database.prepare('SELECT id FROM requests WHERE id = ?').get(expense.requestId)) {
    response.status(400).json({ error: 'The selected project no longer exists.' });
    return;
  }
  const id = randomUUID();
  database.prepare(`
    INSERT INTO expenses (id, expense_date, category, description, paid_to, amount, request_id, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, expense.expenseDate, expense.category, expense.description, expense.paidTo, roundMoney(expense.amount),
    expense.requestId || null, response.locals.user.email);
  response.status(201).json({ id, message: 'Expense recorded.' });
});

app.post('/api/admin/expenses/:id/void', requireAuth, (request, response) => {
  const parsed = voidSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Give a short reason for voiding this expense.' });
    return;
  }
  const result = database.prepare("UPDATE expenses SET voided_at = datetime('now'), voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL")
    .run(response.locals.user.email, parsed.data.reason, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Expense not found or already voided.' });
    return;
  }
  response.json({ message: 'Expense voided. It stays in the history.' });
});

// Reschedule a customer's site meeting or mark it postponed / done / cancelled.
app.patch('/api/admin/requests/:id/meeting', requireAuth, async (request, response) => {
  const parsed = meetingUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Choose a valid date and status for the meeting.' });
    return;
  }
  const { preferredMeeting, meetingStatus, meetingNote } = parsed.data;
  const before = database.prepare(`
    SELECT phone, sms_consent AS smsConsent, preferred_meeting AS preferredMeeting, meeting_status AS meetingStatus
    FROM requests WHERE id = ?
  `).get(request.params.id) as { phone: string; smsConsent: number; preferredMeeting: string; meetingStatus: string } | undefined;
  if (!before) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }
  database.prepare('UPDATE requests SET preferred_meeting = ?, meeting_status = ?, meeting_note = ? WHERE id = ?')
    .run(preferredMeeting, meetingStatus, meetingNote, request.params.id);

  // Text the customer (to the phone on their request) only when what they need to know changed.
  const changed = before.preferredMeeting !== preferredMeeting || before.meetingStatus !== meetingStatus;
  let text = '';
  if (changed && meetingStatus === 'postponed') text = 'Project X: your site meeting has been postponed. We will call you to confirm a new time.';
  else if (changed && meetingStatus === 'cancelled') text = 'Project X: your site meeting has been cancelled. Call us at +1 (202) 460-3027 with any questions.';
  else if (changed && meetingStatus === 'scheduled' && preferredMeeting) text = `Project X: your site meeting is set for ${formatMeetingForSms(preferredMeeting)}.`;
  let smsStatus: SmsResult | 'not_needed' = 'not_needed';
  if (text) smsStatus = before.smsConsent && before.phone ? await sendCustomerSms(before.phone, text) : 'no_consent';
  response.json({ message: 'Meeting updated.', smsStatus });
});

const calendarEventColumnsSql = `calendar_events.id, title, event_date AS eventDate, start_time AS startTime, kind,
  calendar_events.status AS status, note, request_id AS requestId, requests.name AS projectName,
  created_by AS createdBy, updated_by AS updatedBy, calendar_events.updated_at AS updatedAt`;

app.get('/api/admin/calendar/events', requireAuth, (request, response) => {
  const parsed = financeQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: 'Use dates in YYYY-MM-DD format.' });
    return;
  }
  const { from = '0000-01-01', to = '9999-12-31' } = parsed.data;
  const events = database.prepare(`
    SELECT ${calendarEventColumnsSql} FROM calendar_events LEFT JOIN requests ON requests.id = calendar_events.request_id
    WHERE event_date BETWEEN ? AND ? ORDER BY event_date, start_time
  `).all(from, to);
  response.json({ events });
});

function validEventProject(requestId: string): boolean {
  return !requestId || Boolean(database.prepare('SELECT id FROM requests WHERE id = ?').get(requestId));
}

app.post('/api/admin/calendar/events', requireAuth, (request, response) => {
  const parsed = calendarEventSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the event title, date and time.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const event = parsed.data;
  if (!validEventProject(event.requestId)) {
    response.status(400).json({ error: 'The selected project no longer exists.' });
    return;
  }
  const id = randomUUID();
  database.prepare(`
    INSERT INTO calendar_events (id, title, event_date, start_time, kind, status, note, request_id, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, event.title, event.eventDate, event.startTime, event.kind, event.status, event.note, event.requestId || null,
    response.locals.user.email, response.locals.user.email);
  response.status(201).json({ id, message: 'Event added to the calendar.' });
});

app.patch('/api/admin/calendar/events/:id', requireAuth, (request, response) => {
  const parsed = calendarEventSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the event title, date and time.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const event = parsed.data;
  if (!validEventProject(event.requestId)) {
    response.status(400).json({ error: 'The selected project no longer exists.' });
    return;
  }
  const result = database.prepare(`
    UPDATE calendar_events SET title = ?, event_date = ?, start_time = ?, kind = ?, status = ?, note = ?, request_id = ?,
      updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(event.title, event.eventDate, event.startTime, event.kind, event.status, event.note, event.requestId || null,
    response.locals.user.email, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Event not found.' });
    return;
  }
  response.json({ message: 'Event updated.' });
});

app.delete('/api/admin/calendar/events/:id', requireAuth, (request, response) => {
  const result = database.prepare('DELETE FROM calendar_events WHERE id = ?').run(request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Event not found.' });
    return;
  }
  response.json({ message: 'Event deleted.' });
});

// Cash-basis profit for a period: money kept (payments − refunds) minus recorded expenses.
app.get('/api/admin/finance', requireAuth, (request, response) => {
  const parsed = financeQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: 'Use dates in YYYY-MM-DD format.' });
    return;
  }
  const { from = '0000-01-01', to = '9999-12-31' } = parsed.data;
  const money = database.prepare(`
    SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount ELSE 0 END), 0) AS payments,
      COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END), 0) AS refunds
    FROM payments WHERE voided_at IS NULL AND date(received_at) BETWEEN ? AND ?
  `).get(from, to) as { payments: number; refunds: number };
  const byCategory = database.prepare(`
    SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC
  `).all(from, to) as Array<{ category: string; total: number; count: number }>;
  const ledger = database.prepare(`
    SELECT ${paymentColumnsSql}, requests.name AS customerName
    FROM payments JOIN requests ON requests.id = payments.request_id
    WHERE date(payments.received_at) BETWEEN ? AND ? ORDER BY payments.received_at DESC, payments.rowid DESC
  `).all(from, to);
  const expensesTotal = roundMoney(byCategory.reduce((sum, row) => sum + row.total, 0));
  const netReceived = roundMoney(money.payments - money.refunds);
  const netProfit = roundMoney(netReceived - expensesTotal);
  response.json({
    period: { from: parsed.data.from ?? null, to: parsed.data.to ?? null },
    payments: roundMoney(money.payments),
    refunds: roundMoney(money.refunds),
    netReceived,
    expenses: expensesTotal,
    netProfit,
    marginPercent: netReceived > 0 ? Math.round((netProfit / netReceived) * 1000) / 10 : null,
    expensesByCategory: byCategory.map((row) => ({ ...row, total: roundMoney(row.total) })),
    ledger,
  });
});

app.get('/api/admin/materials', requireAuth, (_request, response) => {
  const materials = database.prepare(`
    SELECT id, name, category, unit, unit_price AS unitPrice, supplier, sku,
      stock_qty AS stockQty, price_source AS priceSource, supplier_url AS supplierUrl,
      supplier_store AS supplierStore, image_url AS imageUrl, price_checked_at AS priceCheckedAt,
      updated_at AS updatedAt
    FROM materials WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE
  `).all() as Array<Record<string, unknown> & { category: string }>;
  response.json({ materials: materials.map((material) => ({
    ...material,
    imageUrl: material.imageUrl || materialImage(material.category),
  })) });
});

app.post('/api/admin/materials', requireAuth, (request, response) => {
  const parsed = materialSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the material details.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const material = parsed.data;
  const id = randomUUID();
  database.prepare(`
    INSERT INTO materials (id, name, category, unit, unit_price, supplier, sku, stock_qty, price_source,
      supplier_url, supplier_store, image_url, price_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'lowes' THEN datetime('now') ELSE NULL END)
  `).run(id, material.name, material.category, material.unit, material.unitPrice, material.supplier, material.sku,
    material.stockQty, material.priceSource, material.supplierUrl, material.supplierStore, material.imageUrl, material.supplier.toLowerCase().includes('lowe') ? 'lowes' : 'other');
  response.status(201).json({ id, message: 'Material added.' });
});

// Stock is not editable here: it changes only through recorded inventory movements.
app.patch('/api/admin/materials/:id', requireAuth, (request, response) => {
  const parsed = materialUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the material details.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const material = parsed.data;
  const result = database.prepare(`
    UPDATE materials SET name = ?, category = ?, unit = ?, supplier = ?, sku = ?, price_source = ?,
      supplier_url = ?, supplier_store = ?, image_url = ?,
      price_checked_at = CASE WHEN unit_price != ? THEN datetime('now') ELSE price_checked_at END,
      unit_price = ?, updated_at = datetime('now')
    WHERE id = ? AND archived_at IS NULL
  `).run(material.name, material.category, material.unit, material.supplier, material.sku, material.priceSource,
    material.supplierUrl, material.supplierStore, material.imageUrl, material.unitPrice, material.unitPrice, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Material not found.' });
    return;
  }
  response.json({ message: 'Material updated.' });
});

// Removing archives the item so stock history and past quotes keep their references.
app.delete('/api/admin/materials/:id', requireAuth, (request, response) => {
  const result = database.prepare("UPDATE materials SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL")
    .run(request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Material not found.' });
    return;
  }
  response.json({ message: 'Material removed from the catalog.' });
});

app.get('/api/admin/inventory', requireAuth, (_request, response) => {
  const summary = database.prepare(`
    SELECT COUNT(*) AS itemCount, COALESCE(SUM(stock_qty), 0) AS unitCount,
      SUM(CASE WHEN stock_qty <= 2 THEN 1 ELSE 0 END) AS lowStockCount,
      COALESCE(SUM(stock_qty * unit_price), 0) AS stockValue
    FROM materials WHERE archived_at IS NULL
  `).get() as { itemCount: number; unitCount: number; lowStockCount: number | null; stockValue: number };
  const items = database.prepare(`
    SELECT id, name, category, unit, unit_price AS unitPrice, supplier, sku,
      stock_qty AS stockQty, price_source AS priceSource, updated_at AS updatedAt
    FROM materials WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE
  `).all();
  const movements = database.prepare(`
    SELECT inventory_movements.id AS id, material_id AS materialId, materials.name AS materialName,
      materials.unit AS unit, quantity_change AS quantityChange, note, actor_email AS actorEmail,
      inventory_movements.created_at AS createdAt
    FROM inventory_movements JOIN materials ON materials.id = inventory_movements.material_id
    ORDER BY inventory_movements.created_at DESC LIMIT 30
  `).all();
  response.json({ inventory: { ...summary, lowStockCount: summary.lowStockCount ?? 0 }, items, movements });
});

app.post('/api/admin/inventory/movements', requireAuth, (request, response) => {
  const parsed = inventoryMovementSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Check the stock movement details.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const movement = parsed.data;
  const round = (value: number) => Math.round(value * 100) / 100;
  const quantityChange = round(movement.quantityChange);
  // Read, check and write in one transaction so two staff members cannot overwrite each other's change.
  const saveMovement = database.transaction(() => {
    const material = database.prepare('SELECT stock_qty AS stockQty, unit FROM materials WHERE id = ? AND archived_at IS NULL')
      .get(movement.materialId) as { stockQty: number; unit: string } | undefined;
    if (!material) return { status: 404, body: { error: 'Material not found.' } };
    // The form sends the stock it showed; if someone changed it meanwhile, ask the user to review instead of guessing.
    if (movement.expectedStock !== undefined && round(movement.expectedStock) !== round(material.stockQty)) {
      return { status: 409, body: { error: `Stock changed while you were editing. It is now ${round(material.stockQty)} ${material.unit}. Review and try again.`, stockQty: round(material.stockQty) } };
    }
    if (quantityChange === 0) return { status: 400, body: { error: 'Quantity change cannot be zero.' } };
    const nextStock = round(material.stockQty + quantityChange);
    if (nextStock < 0) {
      return { status: 409, body: { error: `This movement would make stock negative. Current stock: ${round(material.stockQty)} ${material.unit}.`, stockQty: round(material.stockQty) } };
    }
    database.prepare("UPDATE materials SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?").run(nextStock, movement.materialId);
    database.prepare(`
      INSERT INTO inventory_movements (id, material_id, quantity_change, note, actor_email)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), movement.materialId, quantityChange, movement.note, response.locals.user.email);
    return { status: 201, body: { message: 'Stock movement recorded.', stockQty: nextStock } };
  });
  const result = saveMovement();
  response.status(result.status).json(result.body);
});

app.patch('/api/admin/requests/:id', requireAuth, (request, response) => {
  const parsed = statusSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid request status.' });
    return;
  }
  const result = database.prepare('UPDATE requests SET status = ? WHERE id = ?').run(parsed.data.status, request.params.id);
  if (result.changes === 0) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }
  response.json({ message: 'Request updated.' });
});

app.get('/api/admin/requests/:id/material-followups', requireAuth, (request, response) => {
  const exists = database.prepare('SELECT id FROM requests WHERE id = ?').get(request.params.id);
  if (!exists) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }
  const followups = database.prepare(`
    SELECT id, items_json AS itemsJson, message, delivery_status AS deliveryStatus,
      created_by AS createdBy, created_at AS createdAt, sent_at AS sentAt
    FROM material_followups WHERE request_id = ? ORDER BY created_at DESC
  `).all(request.params.id) as Array<{
    id: string; itemsJson: string; message: string; deliveryStatus: string;
    createdBy: string; createdAt: string; sentAt: string | null;
  }>;
  response.json({ followups: followups.map(({ itemsJson, ...followup }) => ({ ...followup, items: JSON.parse(itemsJson) })) });
});

app.post('/api/admin/requests/:id/material-followups', requireAuth, async (request, response) => {
  const parsed = materialFollowupSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Add at least one material with a valid quantity and unit.' });
    return;
  }
  const customer = database.prepare(`
    SELECT name, email, project_type AS projectType, property_address AS propertyAddress
    FROM requests WHERE id = ?
  `).get(request.params.id) as { name: string; email: string; projectType: string; propertyAddress: string } | undefined;
  if (!customer) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }

  const followup = parsed.data;
  const id = randomUUID();
  const deliveryStatus = await sendMaterialFollowupEmail(customer, followup.items, followup.message);
  database.prepare(`
    INSERT INTO material_followups (id, request_id, items_json, message, delivery_status, created_by, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END)
  `).run(id, request.params.id, JSON.stringify(followup.items), followup.message, deliveryStatus, response.locals.user.email, deliveryStatus);
  response.status(201).json({
    id,
    deliveryStatus,
    message: deliveryStatus === 'sent'
      ? 'Material request saved and emailed to the customer.'
      : deliveryStatus === 'not_configured'
        ? 'Material request saved, but email is not configured. Add Resend settings to send it.'
        : 'Material request saved, but the email could not be sent. Check Resend settings and try again.',
  });
});

app.get('/api/admin/requests/:id/quotes', requireAuth, (request, response) => {
  const exists = database.prepare('SELECT id FROM requests WHERE id = ?').get(request.params.id);
  if (!exists) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }
  const quotes = database.prepare(`
    SELECT id, quote_number AS quoteNumber, lines_json AS linesJson,
      cost_subtotal AS costSubtotal, margin_percent AS marginPercent, gross_profit AS grossProfit,
      material_subtotal AS materialSubtotal, labor_subtotal AS laborSubtotal,
      other_subtotal AS otherSubtotal, subtotal, tax_percent AS taxPercent,
      tax_amount AS taxAmount, total, note, public_token AS publicToken,
      CASE WHEN subtotal > 0 THEN ROUND((gross_profit / subtotal) * 10000) / 100 ELSE 0 END AS grossMarginPercent,
      delivery_status AS deliveryStatus,
      created_by AS createdBy, created_at AS createdAt, sent_at AS sentAt
    FROM quotes WHERE request_id = ? ORDER BY created_at DESC
  `).all(request.params.id) as Array<Record<string, unknown> & { linesJson: string }>;
  response.json({ quotes: quotes.map(({ linesJson, ...quote }) => ({ ...quote, lines: JSON.parse(linesJson) })) });
});

app.post('/api/admin/requests/:id/quotes', requireAuth, async (request, response) => {
  const parsed = quoteSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Add valid quote lines with a description, quantity, unit, and unit price.' });
    return;
  }
  const customer = database.prepare(`
    SELECT name, email, phone, sms_consent AS smsConsent, project_type AS projectType, property_address AS propertyAddress
    FROM requests WHERE id = ?
  `).get(request.params.id) as { name: string; email: string; phone: string; smsConsent: number; projectType: string; propertyAddress: string } | undefined;
  if (!customer) {
    response.status(404).json({ error: 'Request not found.' });
    return;
  }

  const quoteInput = parsed.data;
  const marginPercent = quoteInput.marginPercent;
  const marginFactor = 1 - marginPercent / 100;
  const lines: QuoteLine[] = [];
  for (const inputLine of quoteInput.lines) {
    let description = inputLine.description;
    let unit = inputLine.unit;
    let unitCost = inputLine.unitCost;
    let imageUrl: string | undefined;
    if (inputLine.materialId) {
      if (inputLine.type !== 'material') {
        response.status(400).json({ error: 'Catalog items can only be used on material quote lines.' });
        return;
      }
      const catalogItem = database.prepare('SELECT name, category, unit, unit_price AS unitCost, image_url AS imageUrl FROM materials WHERE id = ? AND archived_at IS NULL')
        .get(inputLine.materialId) as { name: string; category: string; unit: string; unitCost: number; imageUrl: string } | undefined;
      if (!catalogItem) {
        response.status(400).json({ error: 'A selected catalog material is no longer available.' });
        return;
      }
      description = catalogItem.name;
      unit = catalogItem.unit;
      unitCost = catalogItem.unitCost;
      imageUrl = catalogItem.imageUrl || materialImage(catalogItem.category);
    }
    const unitPrice = Math.round((unitCost / marginFactor) * 100) / 100;
    lines.push({
      type: inputLine.type,
      description,
      quantity: inputLine.quantity,
      unit,
      unitCost: Math.round(unitCost * 100) / 100,
      unitPrice,
      lineCost: Math.round(inputLine.quantity * unitCost * 100) / 100,
      lineTotal: Math.round(inputLine.quantity * unitPrice * 100) / 100,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  const costSubtotal = Math.round(lines.reduce((sum, line) => sum + Math.round(line.lineCost * 100), 0)) / 100;
  const centsFor = (type: QuoteLine['type']) => Math.round(lines
    .filter((line) => line.type === type)
    .reduce((sum, line) => sum + Math.round(line.lineTotal * 100), 0));
  const materialSubtotal = centsFor('material') / 100;
  const laborSubtotal = centsFor('labor') / 100;
  const otherSubtotal = centsFor('other') / 100;
  const subtotal = Math.round((materialSubtotal + laborSubtotal + otherSubtotal) * 100) / 100;
  const taxPercent = quoteInput.taxPercent;
  const taxAmount = Math.round(subtotal * taxPercent) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const grossProfit = Math.round((subtotal - costSubtotal) * 100) / 100;
  const grossMarginPercent = subtotal > 0 ? Math.round((grossProfit / subtotal) * 10000) / 100 : 0;
  const id = randomUUID();
  const quoteNumber = `PXQ-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  const publicToken = randomBytes(32).toString('base64url');
  const quoteUrl = new URL(`/step-2-quote?quote=${publicToken}`, frontendOrigin).toString();
  database.prepare(`
    INSERT INTO quotes (id, request_id, quote_number, lines_json, cost_subtotal, material_subtotal, labor_subtotal,
      other_subtotal, subtotal, tax_percent, tax_amount, margin_percent, gross_profit, total, note, created_by, public_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, request.params.id, quoteNumber, JSON.stringify(lines), costSubtotal, materialSubtotal, laborSubtotal,
    otherSubtotal, subtotal, taxPercent, taxAmount, marginPercent, grossProfit, total, quoteInput.note, response.locals.user.email, publicToken);

  const deliveryStatus = await sendQuoteEmail({
    quoteNumber, customerName: customer.name, customerEmail: customer.email,
    projectType: customer.projectType, propertyAddress: customer.propertyAddress,
    lines, materialSubtotal, laborSubtotal, otherSubtotal, subtotal, taxPercent, taxAmount, total, note: quoteInput.note, quoteUrl,
    senderName: quoteInput.senderName,
  });
  database.prepare(`
    UPDATE quotes SET delivery_status = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END WHERE id = ?
  `).run(deliveryStatus, deliveryStatus, id);
  const smsStatus: SmsResult = customer.smsConsent && customer.phone
    ? await sendCustomerSms(customer.phone, `Project X: your itemized quote ${quoteNumber} ($${total.toFixed(2)}) is ready: ${quoteUrl}`)
    : 'no_consent';
  response.status(201).json({
    id, quoteNumber, quoteUrl, lines, costSubtotal, marginPercent, grossProfit, grossMarginPercent,
    materialSubtotal, laborSubtotal, otherSubtotal, subtotal, taxPercent, taxAmount, total, deliveryStatus, smsStatus,
    message: deliveryStatus === 'sent'
      ? `Quote ${quoteNumber} created and emailed to the customer.`
      : deliveryStatus === 'not_configured'
        ? `Quote ${quoteNumber} saved, but email is not configured. Add Resend settings to send it.`
        : `Quote ${quoteNumber} saved, but email delivery failed.`,
  });
});

app.get('/api/quotes/:publicToken', (request, response) => {
  const quote = database.prepare(`
    SELECT quotes.quote_number AS quoteNumber, quotes.lines_json AS linesJson,
      quotes.material_subtotal AS materialSubtotal, quotes.labor_subtotal AS laborSubtotal,
      quotes.other_subtotal AS otherSubtotal, quotes.subtotal, quotes.tax_percent AS taxPercent,
      quotes.tax_amount AS taxAmount, quotes.total, quotes.note,
      requests.name AS customerName, requests.project_type AS projectType,
      requests.property_address AS propertyAddress
    FROM quotes JOIN requests ON requests.id = quotes.request_id
    WHERE quotes.public_token = ?
  `).get(request.params.publicToken) as Record<string, unknown> & { linesJson: string } | undefined;
  if (!quote) {
    response.status(404).json({ error: 'This quote link is invalid or has expired.' });
    return;
  }
  const lines = JSON.parse(quote.linesJson) as QuoteLine[];
  const { linesJson: _linesJson, ...publicQuote } = quote;
  response.json({
    ...publicQuote,
    lines: lines.map(({ type, description, quantity, unit, unitPrice, lineTotal, imageUrl }) => ({
      type, description, quantity, unit, unitPrice, lineTotal, imageUrl,
    })),
  });
});

// Production: one server for the website and the API, so the frontend calls /api on its own origin.
if (process.env.SERVE_FRONTEND === 'true') {
  const siteRoot = resolve(process.env.FRONTEND_DIST ?? resolve(process.cwd(), '../frontend/dist'));
  if (!existsSync(join(siteRoot, 'pages'))) console.warn(`SERVE_FRONTEND is on, but no built site was found at ${siteRoot}. Run "npm run build" first.`);
  const publicPages = new Set(['work', 'about', 'careers', 'contact', 'privacy', 'step-2-quote', 'step-5-delivery']);
  // Step pages that were removed; old emailed links (?verify=, ?quote=) keep working through these redirects.
  const removedPages: Record<string, string> = { 'step-1-request': '/contact', 'step-3-deposit': '/step-2-quote', 'step-4-build': '/' };
  const siteOrigin = frontendOrigin.replace(/\/+$/, '');
  const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // Link previews and canonical URLs need the absolute domain, which is only known at runtime (FRONTEND_ORIGIN).
  const withShareTags = (html: string, cleanPath: string) => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'Project X Contractors';
    const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    const url = `${siteOrigin}${cleanPath}`;
    const tags = [
      `<link rel="canonical" href="${attr(url)}"/>`,
      '<meta property="og:type" content="website"/>',
      '<meta property="og:site_name" content="Project X Contractors"/>',
      `<meta property="og:title" content="${title}"/>`,
      `<meta property="og:description" content="${description}"/>`,
      `<meta property="og:url" content="${attr(url)}"/>`,
      `<meta property="og:image" content="${attr(`${siteOrigin}/assets/og-image.jpg`)}"/>`,
      '<meta property="og:image:width" content="1200"/>',
      '<meta property="og:image:height" content="630"/>',
      '<meta name="twitter:card" content="summary_large_image"/>',
    ].join('\n');
    return html.replace('</head>', `${tags}\n</head>`);
  };
  const sendPage = (response: Response, file: string, next: NextFunction, cleanPath?: string) => {
    response.setHeader('Cache-Control', 'no-cache');
    if (!cleanPath) {
      response.sendFile(join(siteRoot, file), (error) => { if (error) next(); });
      return;
    }
    readFile(join(siteRoot, file), 'utf8')
      .then((html) => response.type('html').send(withShareTags(html, cleanPath)))
      .catch(() => next());
  };
  app.get('/robots.txt', (_request, response) => {
    response.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${siteOrigin}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_request, response) => {
    const entries = [...publicPages].map((page) => {
      const file = join(siteRoot, 'pages', `${page}.html`);
      const lastmod = existsSync(file) ? statSync(file).mtime.toISOString().slice(0, 10) : undefined;
      const priority = page === 'work' ? '1.0' : ['about', 'contact', 'careers'].includes(page) ? '0.8' : page === 'privacy' ? '0.3' : '0.5';
      return `  <url><loc>${siteOrigin}${page === 'work' ? '/' : `/${page}`}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority></url>`;
    });
    response.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
  });
  // Clean addresses: / and /work show the Work page, /about → pages/about.html, /admin/login → admin/login.html.
  // Old /pages/x.html and /admin/x.html links (including emailed quote links) redirect permanently, keeping the query.
  app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?')) : '';
    const legacyPage = /^\/pages\/([\w-]+)\.html$/.exec(request.path);
    if (legacyPage) {
      const target = removedPages[legacyPage[1]] ?? (legacyPage[1] === 'work' ? '/' : `/${legacyPage[1]}`);
      response.redirect(301, `${target}${query}`);
      return;
    }
    const removedTarget = removedPages[request.path.slice(1)];
    if (removedTarget) {
      response.redirect(301, `${removedTarget}${query}`);
      return;
    }
    const legacyAdmin = /^\/admin\/([\w-]+)\.html$/.exec(request.path);
    if (legacyAdmin) {
      response.redirect(301, `/admin/${legacyAdmin[1]}${query}`);
      return;
    }
    if (request.path === '/') {
      sendPage(response, 'pages/work.html', next, '/');
      return;
    }
    const page = /^\/([\w-]+)$/.exec(request.path)?.[1];
    if (page && publicPages.has(page)) {
      sendPage(response, `pages/${page}.html`, next, page === 'work' ? '/' : `/${page}`);
      return;
    }
    const adminPage = /^\/admin\/([\w-]+)$/.exec(request.path)?.[1];
    if (adminPage && existsSync(join(siteRoot, 'admin', `${adminPage}.html`))) {
      sendPage(response, `admin/${adminPage}.html`, next);
      return;
    }
    next();
  });
  app.use(express.static(siteRoot, {
    extensions: ['html'],
    setHeaders: (response, filePath) => {
      // Photos and built scripts change rarely; pages are re-checked so content updates show up right away.
      response.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=604800');
    },
  }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next();
      return;
    }
    response.status(404).sendFile(join(siteRoot, 'pages', '404.html'), (error) => { if (error) next(); });
  });
}

app.use((_request, response) => response.status(404).json({ error: 'Not found.' }));

// Last resort for anything a route did not handle: log it, alert staff, and answer with a generic message.
app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  // Malformed JSON and oversized bodies are the visitor's input, not a server fault.
  const status = (error as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    response.status(status).json({ error: status === 413 ? 'That upload is too large.' : 'The request could not be read.' });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unhandled error on ${request.method} ${request.path}:`, error);
  recordError('server', message, error instanceof Error ? error.stack ?? '' : '', `${request.method} ${request.path}`, request.get('user-agent') ?? '');
  void alertOperators(`route:${request.path}`, `${request.method} ${request.path} failed: ${message}`.slice(0, 300));
  response.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

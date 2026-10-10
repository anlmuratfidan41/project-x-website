import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { database } from '../src/database.js';

const validRequest = {
  name: 'Taylor Morgan',
  email: 'taylor@example.com',
  phone: '+12025550199',
  projectType: 'Water damage restoration',
  propertyAddress: '1200 Example Street NW, Washington, DC',
  preferredMeeting: 'Weekday mornings',
  idealStart: '2026-10-15',
  message: 'Water damage affected drywall in the basement.',
  smsConsent: false,
};

beforeEach(() => {
  database.prepare('DELETE FROM sessions').run();
  database.prepare('DELETE FROM requests').run();
  database.prepare('DELETE FROM materials').run();
  database.prepare('DELETE FROM users').run();
});

afterAll(() => database.close());

describe('Project X API', () => {
  it('rejects invalid public request data', async () => {
    await request(app).post('/api/requests').send({ ...validRequest, email: 'not-an-email' }).expect(400);
    expect(database.prepare('SELECT COUNT(*) AS count FROM requests').get()).toMatchObject({ count: 0 });
  });

  it('persists a valid public project request', async () => {
    const response = await request(app).post('/api/requests').send(validRequest).expect(201);
    expect(response.body.message).toContain('received');
    expect(database.prepare('SELECT email, status FROM requests').get()).toMatchObject({ email: validRequest.email, status: 'new' });
  });

  it('keeps a request unconfirmed until the emailed link is opened', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const created = await request(app).post('/api/requests').send(validRequest).expect(201);
    expect(created.body.verificationRequired).toBe(true);
    const link = String(log.mock.calls.flat().find((entry) => String(entry).includes('verify=')));
    log.mockRestore();
    const token = new URL(link.slice(link.indexOf('http'))).searchParams.get('verify')!;
    expect(database.prepare('SELECT email_verified_at AS verifiedAt FROM requests').get()).toMatchObject({ verifiedAt: null });

    await request(app).post('/api/requests/verify').send({ token: 'x'.repeat(43) }).expect(400);
    const verified = await request(app).post('/api/requests/verify').send({ token }).expect(200);
    expect(verified.body).toMatchObject({ name: validRequest.name, alreadyVerified: false });
    expect((await request(app).post('/api/requests/verify').send({ token }).expect(200)).body.alreadyVerified).toBe(true);
    expect(database.prepare('SELECT email_verified_at AS verifiedAt FROM requests').get()).not.toMatchObject({ verifiedAt: null });
  });

  it('protects the inbox and permits access after staff sign-in', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    await request(app).get('/api/admin/requests').expect(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    const inbox = await agent.get('/api/admin/requests').expect(200);
    expect(inbox.body.requests).toEqual([]);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/admin/requests').expect(401);
  });

  it('sends www visitors to the single public address when serving the site', async () => {
    // FRONTEND_ORIGIN is http://localhost:5173 in tests, so www.localhost:5173 plays the part of www.projectx.build.
    vi.stubEnv('SERVE_FRONTEND', 'true');
    const moved = await request(app).get('/step-2-quote?quote=abc').set('Host', 'www.localhost:5173').expect(301);
    expect(moved.headers.location).toBe('http://localhost:5173/step-2-quote?quote=abc');
    vi.unstubAllEnvs();
    await request(app).get('/api/health').set('Host', 'www.localhost:5173').expect(200);
  });

  it('reports health, collects browser errors, and lists them for staff', async () => {
    database.prepare('DELETE FROM error_log').run();
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.status).toBe('ok');

    await request(app).post('/api/client-errors').send({ message: '' }).expect(400);
    await request(app).post('/api/client-errors').set('User-Agent', 'TestBrowser/1.0')
      .send({ message: 'TypeError: x is undefined', stack: 'at render (page-runtime.js:10)', page: '/contact' }).expect(204);
    await request(app).post('/api/requests').set('Content-Type', 'application/json').send('{"broken json').expect(400);

    await request(app).get('/api/admin/errors').expect(401);
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-owner', 'owner@example.com', passwordHash);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    const { body } = await agent.get('/api/admin/errors').expect(200);
    // Bad JSON from a visitor is not logged as a server fault.
    expect(body.errors).toEqual([expect.objectContaining({ source: 'client', message: 'TypeError: x is undefined', path: '/contact', userAgent: 'TestBrowser/1.0' })]);
    expect(body.last24h).toEqual({ server: 0, client: 1 });
    await agent.post('/api/admin/errors/clear').expect(200);
    expect((await agent.get('/api/admin/errors')).body.errors).toEqual([]);
  });

  it('lets staff reschedule or postpone meetings and manage their own calendar events', async () => {
    database.prepare('DELETE FROM calendar_events').run();
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-owner', 'owner@example.com', passwordHash);
    await request(app).post('/api/requests').send({ ...validRequest, preferredMeeting: '2026-10-05T10:00' }).expect(201);
    const { id: requestId } = database.prepare('SELECT id FROM requests').get() as { id: string };
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);

    expect((await agent.get('/api/admin/requests')).body.requests[0]).toMatchObject({ meetingStatus: 'scheduled', meetingNote: '' });
    await agent.patch(`/api/admin/requests/${requestId}/meeting`).send({ preferredMeeting: 'next week', meetingStatus: 'postponed' }).expect(400);
    const moved = await agent.patch(`/api/admin/requests/${requestId}/meeting`)
      .send({ preferredMeeting: '2026-10-09T14:30', meetingStatus: 'postponed', meetingNote: 'Customer travelling' }).expect(200);
    // The request was sent without SMS consent, so the customer is not texted.
    expect(moved.body.smsStatus).toBe('no_consent');
    const unchanged = await agent.patch(`/api/admin/requests/${requestId}/meeting`)
      .send({ preferredMeeting: '2026-10-09T14:30', meetingStatus: 'postponed', meetingNote: 'Customer travelling' }).expect(200);
    expect(unchanged.body.smsStatus).toBe('not_needed');
    expect((await agent.get('/api/admin/requests')).body.requests[0])
      .toMatchObject({ preferredMeeting: '2026-10-09T14:30', meetingStatus: 'postponed', meetingNote: 'Customer travelling' });

    await request(app).post('/api/admin/calendar/events').send({ title: 'x' }).expect(401);
    const event = { title: 'Tile delivery', eventDate: '2026-10-07', startTime: '08:00', kind: 'delivery', note: 'Gate code 1234', requestId };
    await agent.post('/api/admin/calendar/events').send({ ...event, startTime: '25:00' }).expect(400);
    const { body: created } = await agent.post('/api/admin/calendar/events').send(event).expect(201);
    await agent.patch(`/api/admin/calendar/events/${created.id}`).send({ ...event, eventDate: '2026-10-08', status: 'postponed' }).expect(200);
    const october = (await agent.get('/api/admin/calendar/events?from=2026-10-01&to=2026-10-31').expect(200)).body.events;
    expect(october).toEqual([expect.objectContaining({ title: 'Tile delivery', eventDate: '2026-10-08', status: 'postponed', projectName: validRequest.name })]);
    expect((await agent.get('/api/admin/calendar/events?from=2026-11-01&to=2026-11-30')).body.events).toEqual([]);
    await agent.delete(`/api/admin/calendar/events/${created.id}`).expect(200);
    await agent.delete(`/api/admin/calendar/events/${created.id}`).expect(404);
  });

  it('keeps a payment history with refunds and voids, and calculates profit after expenses', async () => {
    database.prepare('DELETE FROM expenses').run();
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-owner', 'owner@example.com', passwordHash);
    await request(app).post('/api/requests').send(validRequest).expect(201);
    const { id: requestId } = database.prepare('SELECT id FROM requests').get() as { id: string };
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);

    await agent.post(`/api/admin/requests/${requestId}/payments`).send({ amount: 1000, note: 'Deposit' }).expect(201);
    await agent.post(`/api/admin/requests/${requestId}/payments`).send({ amount: 250.5, note: 'Second draw' }).expect(201);
    await agent.post(`/api/admin/requests/${requestId}/payments`).send({ amount: 5000, kind: 'refund' }).expect(409);
    await agent.post(`/api/admin/requests/${requestId}/payments`).send({ amount: 100, kind: 'refund', note: 'Unused tile' }).expect(201);
    let history = (await agent.get(`/api/admin/requests/${requestId}/payments`).expect(200)).body;
    expect(history.netPaid).toBe(1150.5);
    expect(history.payments).toHaveLength(3);

    const second = history.payments.find((entry: { note: string }) => entry.note === 'Second draw');
    await agent.post(`/api/admin/payments/${second.id}/void`).send({ reason: 'x' }).expect(400);
    await agent.post(`/api/admin/payments/${second.id}/void`).send({ reason: 'Entered twice' }).expect(200);
    await agent.post(`/api/admin/payments/${second.id}/void`).send({ reason: 'Entered twice' }).expect(409);
    history = (await agent.get(`/api/admin/requests/${requestId}/payments`)).body;
    expect(history.netPaid).toBe(900);
    expect(history.payments).toHaveLength(3);
    expect(history.payments.find((entry: { id: string }) => entry.id === second.id)).toMatchObject({ voidReason: 'Entered twice', voidedBy: 'owner@example.com' });

    const today = new Date().toISOString().slice(0, 10);
    await agent.post('/api/admin/expenses').send({ expenseDate: today, category: 'payroll', description: 'Crew wages, week 40', amount: 600 }).expect(201);
    const { body: wrong } = await agent.post('/api/admin/expenses').send({ expenseDate: today, category: 'vehicle', description: 'Fuel', amount: 80, requestId }).expect(201);
    await agent.post('/api/admin/expenses').send({ expenseDate: 'yesterday', category: 'payroll', description: 'Bad date', amount: 1 }).expect(400);
    await agent.post(`/api/admin/expenses/${wrong.id}/void`).send({ reason: 'Wrong amount' }).expect(200);
    const expenses = (await agent.get(`/api/admin/expenses?from=${today}&to=${today}`).expect(200)).body.expenses;
    expect(expenses).toHaveLength(2);
    expect(expenses.find((entry: { id: string }) => entry.id === wrong.id)).toMatchObject({ voidReason: 'Wrong amount', projectName: validRequest.name });

    const finance = (await agent.get(`/api/admin/finance?from=${today}&to=${today}`).expect(200)).body;
    expect(finance).toMatchObject({ payments: 1000, refunds: 100, netReceived: 900, expenses: 600, netProfit: 300, marginPercent: 33.3 });
    expect(finance.expensesByCategory).toEqual([{ category: 'payroll', total: 600, count: 1 }]);
    expect(finance.ledger).toHaveLength(3);
    expect((await agent.get('/api/admin/dashboard')).body.finance).toMatchObject({ received: 900, expenses: 600, netProfit: 300 });
  });

  it('edits a material without touching stock and removes it from every list', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-owner', 'owner@example.com', passwordHash);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    const { body: created } = await agent.post('/api/admin/materials').send({
      name: 'Cement board', category: 'Tile', unit: 'sheet', unitPrice: 12, stockQty: 9, priceSource: 'manual',
    }).expect(201);

    await request(app).patch(`/api/admin/materials/${created.id}`).send({ name: 'x' }).expect(401);
    await agent.patch(`/api/admin/materials/${created.id}`).send({
      name: 'Cement backer board, 1/2 in.', category: 'Tile', unit: 'sheet', unitPrice: 13.5, stockQty: 999, priceSource: 'invoice',
    }).expect(200);
    const [edited] = (await agent.get('/api/admin/materials')).body.materials;
    expect(edited).toMatchObject({ name: 'Cement backer board, 1/2 in.', unitPrice: 13.5, stockQty: 9, priceSource: 'invoice' });
    const editBody = { name: 'Cement backer board, 1/2 in.', category: 'Tile', unit: 'sheet', unitPrice: 13.5, priceSource: 'invoice' };
    await agent.patch(`/api/admin/materials/${created.id}`).send({ ...editBody, imageUrl: '/assets/products/cement-board.jpg' }).expect(200);
    await agent.patch(`/api/admin/materials/${created.id}`).send({ ...editBody, imageUrl: '/assets/../backend/.env' }).expect(400);
    expect((await agent.get('/api/admin/materials')).body.materials[0].imageUrl).toBe('/assets/products/cement-board.jpg');

    await agent.delete(`/api/admin/materials/${created.id}`).expect(200);
    await agent.delete(`/api/admin/materials/${created.id}`).expect(404);
    expect((await agent.get('/api/admin/materials')).body.materials).toEqual([]);
    expect((await agent.get('/api/admin/inventory')).body.items).toEqual([]);
    expect((await agent.get('/api/admin/dashboard')).body.materials.total).toBe(0);
    await agent.post('/api/admin/inventory/movements').send({ materialId: created.id, quantityChange: 1, note: 'Restock' }).expect(404);
    expect(database.prepare('SELECT COUNT(*) AS n FROM materials WHERE archived_at IS NOT NULL').get()).toMatchObject({ n: 1 });
  });

  it('accepts job applications with a PDF resume and lists them for staff', async () => {
    database.prepare('DELETE FROM applications').run();
    const application = { name: 'Jordan Lee', email: 'jordan@example.com', phone: '+12025550123', position: 'Drywall Finisher', message: 'Eight years of finishing work.' };
    const pdf = Buffer.from('%PDF-1.4\n% test resume\n').toString('base64');
    await request(app).post('/api/applications').send({ ...application, position: 'Astronaut' }).expect(400);
    await request(app).post('/api/applications').send({ ...application, resume: { name: 'cv.pdf', data: Buffer.from('not a pdf').toString('base64') } }).expect(400);
    await request(app).post('/api/applications').send({ ...application, resume: { name: 'cv.pdf', data: pdf } }).expect(201);

    await request(app).get('/api/admin/applications').expect(401);
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('test-owner', 'owner@example.com', passwordHash);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    const [saved] = (await agent.get('/api/admin/applications').expect(200)).body.applications;
    expect(saved).toMatchObject({ name: 'Jordan Lee', position: 'Drywall Finisher', status: 'new', hasResume: true, resumeName: 'cv.pdf' });
    expect(saved).not.toHaveProperty('resumePdf');
    const resume = await agent.get(`/api/admin/applications/${saved.id}/resume`).expect(200);
    expect(resume.headers['content-type']).toBe('application/pdf');
    await agent.patch(`/api/admin/applications/${saved.id}`).send({ status: 'reviewed' }).expect(200);
  });

  it('lets staff move a request into the in-progress state', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    await request(app).post('/api/requests').send({ ...validRequest, preferredMeeting: '2026-10-05T10:00' }).expect(201);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    const [saved] = (await agent.get('/api/admin/requests').expect(200)).body.requests;
    await agent.patch(`/api/admin/requests/${saved.id}`).send({ status: 'in_progress' }).expect(200);
    await agent.patch(`/api/admin/requests/${saved.id}`).send({ status: 'started' }).expect(400);
    expect((await agent.get('/api/admin/requests')).body.requests[0]).toMatchObject({ status: 'in_progress', preferredMeeting: '2026-10-05T10:00', quoteCount: 0, lastQuote: null });
  });

  it('protects the materials catalog and saves a validated item for signed-in staff', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    await request(app).get('/api/admin/materials').expect(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    await agent.post('/api/admin/materials').send({
      name: 'Type X drywall, 5/8 in.', category: 'Drywall', unit: 'sheet', unitPrice: 18.75,
      supplier: 'Local supplier', stockQty: 6, priceSource: 'invoice',
      supplierUrl: 'https://www.lowes.com/pd/example/123', supplierStore: 'Washington, DC #3256',
      imageUrl: 'https://mobileimages.lowes.com/example.jpg',
    }).expect(201);
    const result = await agent.get('/api/admin/dashboard').expect(200);
    expect(result.body.materials).toMatchObject({ total: 1, missingPrice: 0, lowStock: 0 });
    expect((await agent.get('/api/admin/materials')).body.materials[0]).toMatchObject({
      name: 'Type X drywall, 5/8 in.', unitPrice: 18.75, priceSource: 'invoice',
      supplierUrl: 'https://www.lowes.com/pd/example/123', supplierStore: 'Washington, DC #3256',
      imageUrl: 'https://mobileimages.lowes.com/example.jpg',
    });
  });

  it('records stock movements and prevents inventory from going below zero', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    const materialId = '9eebf225-f42f-4be4-90ee-22b0c4fed387';
    database.prepare(`
      INSERT INTO materials (id, name, category, unit, unit_price, stock_qty)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(materialId, 'Inventory test screws', 'Fasteners', 'box', 12.5, 3);
    await request(app).get('/api/admin/inventory').expect(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);
    await agent.post('/api/admin/inventory/movements').send({
      materialId, quantityChange: 4, note: 'Received invoice INV-42',
    }).expect(201);
    await agent.post('/api/admin/inventory/movements').send({
      materialId, quantityChange: -8, note: 'Should be rejected',
    }).expect(409);
    const result = await agent.get('/api/admin/inventory').expect(200);
    expect(result.body.items[0].stockQty).toBe(7);
    expect(result.body.movements).toHaveLength(1);
    expect(result.body.movements[0]).toMatchObject({ actorEmail: 'owner@example.com', quantityChange: 4 });

    // A form opened when stock was 3 must not apply a change after stock moved to 7.
    const stale = await agent.post('/api/admin/inventory/movements').send({
      materialId, quantityChange: -1, note: 'Used on job', expectedStock: 3,
    }).expect(409);
    expect(stale.body).toMatchObject({ stockQty: 7 });
    expect(stale.body.error).toContain('Stock changed');

    // Decimal quantities are stored rounded to cents, without floating-point drift.
    await agent.post('/api/admin/inventory/movements').send({ materialId, quantityChange: 0.1, note: 'Partial box', expectedStock: 7 }).expect(201);
    const fixed = await agent.post('/api/admin/inventory/movements').send({ materialId, quantityChange: 0.2, note: 'Partial box', expectedStock: 7.1 }).expect(201);
    expect(fixed.body.stockQty).toBe(7.3);
  });

  it('saves a material follow-up for a customer request and reports when email is not configured', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    await request(app).post('/api/requests').send(validRequest).expect(201);
    const savedRequest = database.prepare('SELECT id FROM requests WHERE email = ?').get(validRequest.email) as { id: string };
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);

    const response = await agent.post(`/api/admin/requests/${savedRequest.id}/material-followups`).send({
      items: [{ name: 'Drywall dimensions', quantity: 2, unit: 'photos' }],
      message: 'Please send clear measurements.',
    }).expect(201);
    expect(response.body.deliveryStatus).toBe('not_configured');
    expect(response.body.message).toContain('email is not configured');
    const history = await agent.get(`/api/admin/requests/${savedRequest.id}/material-followups`).expect(200);
    expect(history.body.followups[0]).toMatchObject({
      deliveryStatus: 'not_configured', createdBy: 'owner@example.com',
      items: [{ name: 'Drywall dimensions', quantity: 2, unit: 'photos' }],
    });
  });

  it('calculates material, labor, tax, and total on the server and saves quote history', async () => {
    const passwordHash = await bcrypt.hash('test-password-that-is-long', 4);
    database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .run('test-owner', 'owner@example.com', passwordHash);
    await request(app).post('/api/requests').send(validRequest).expect(201);
    const savedRequest = database.prepare('SELECT id FROM requests WHERE email = ?').get(validRequest.email) as { id: string };
    const catalogMaterialId = '89a32782-3d39-4f8d-bc50-26f28ce4226f';
    database.prepare(`
      INSERT INTO materials (id, name, category, unit, unit_price)
      VALUES (?, ?, ?, ?, ?)
    `).run(catalogMaterialId, 'Type X drywall', 'Drywall', 'sheet', 25);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password-that-is-long' }).expect(200);

    const response = await agent.post(`/api/admin/requests/${savedRequest.id}/quotes`).send({
      lines: [
        { type: 'material', materialId: catalogMaterialId, description: 'Drywall sheets', quantity: 2, unit: 'sheet', unitCost: 99 },
        { type: 'labor', description: 'Carpenter labor', quantity: 3, unit: 'hour', unitCost: 40 },
        { type: 'other', description: 'Delivery', quantity: 1, unit: 'trip', unitCost: 10 },
      ],
      marginPercent: 25,
      taxPercent: 6,
      note: 'Estimate subject to site review.',
    }).expect(201);
    expect(response.body).toMatchObject({
      costSubtotal: 180, marginPercent: 25, grossProfit: 59.98, grossMarginPercent: 24.99,
      materialSubtotal: 66.66, laborSubtotal: 159.99, otherSubtotal: 13.33,
      subtotal: 239.98, taxPercent: 6, taxAmount: 14.4, total: 254.38,
      deliveryStatus: 'not_configured',
    });
    const history = await agent.get(`/api/admin/requests/${savedRequest.id}/quotes`).expect(200);
    expect(history.body.quotes[0]).toMatchObject({ total: 254.38, costSubtotal: 180, grossProfit: 59.98, createdBy: 'owner@example.com' });
    expect(history.body.quotes[0].lines).toHaveLength(3);
    const [inboxItem] = (await agent.get('/api/admin/requests').expect(200)).body.requests;
    expect(inboxItem).toMatchObject({
      quoteCount: 1,
      lastQuote: { quoteNumber: response.body.quoteNumber, total: 254.38, deliveryStatus: 'not_configured', createdBy: 'owner@example.com', approvalStatus: 'pending' },
      paidTotal: 0,
    });
    expect((await agent.get('/api/admin/dashboard')).body.finance).toMatchObject({
      projects: 1, quotedProjects: 1, quotedValue: 254.38, pending: { count: 1, value: 254.38 }, approved: { count: 0, value: 0 }, received: 0,
    });
    await agent.patch(`/api/admin/quotes/${response.body.id}/approval`).send({ approvalStatus: 'approved' }).expect(200);
    await agent.post(`/api/admin/requests/${savedRequest.id}/payments`).send({ amount: 0 }).expect(400);
    await agent.post(`/api/admin/requests/${savedRequest.id}/payments`).send({ amount: 76.31, note: '30% deposit' }).expect(201);
    expect((await agent.get('/api/admin/dashboard')).body.finance).toMatchObject({
      pending: { count: 0, value: 0 }, approved: { count: 1, value: 254.38 }, received: 76.31, outstanding: 178.07,
    });
    expect(history.body.quotes[0].lines.slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'material', lineCost: 50, lineTotal: 66.66 }),
      expect.objectContaining({ type: 'labor', lineCost: 120, lineTotal: 159.99 }),
    ]);
    const token = new URL(response.body.quoteUrl).searchParams.get('quote');
    const publicQuote = await request(app).get(`/api/quotes/${token}`).expect(200);
    expect(publicQuote.body).toMatchObject({ quoteNumber: response.body.quoteNumber, total: 254.38 });
    expect(publicQuote.body.lines[0]).toHaveProperty('imageUrl');
    expect(publicQuote.body).not.toHaveProperty('costSubtotal');
    expect(publicQuote.body).not.toHaveProperty('grossProfit');
    expect(publicQuote.body).not.toHaveProperty('marginPercent');
  });
});

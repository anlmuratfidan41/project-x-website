import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const databasePath = resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/projectx.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'office', 'field')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    project_type TEXT NOT NULL,
    property_address TEXT NOT NULL,
    preferred_meeting TEXT NOT NULL DEFAULT '',
    ideal_start TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'scheduled', 'in_progress', 'declined')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS requests_created_at_idx ON requests(created_at DESC);
  CREATE TABLE IF NOT EXISTS material_followups (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    items_json TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (delivery_status IN ('sent', 'failed', 'not_configured')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS material_followups_request_idx ON material_followups(request_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL UNIQUE,
    lines_json TEXT NOT NULL,
    cost_subtotal REAL NOT NULL DEFAULT 0,
    material_subtotal REAL NOT NULL,
    labor_subtotal REAL NOT NULL,
    other_subtotal REAL NOT NULL,
    subtotal REAL NOT NULL,
    tax_percent REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    margin_percent REAL NOT NULL DEFAULT 25,
    gross_profit REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (delivery_status IN ('sent', 'failed', 'not_configured')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    public_token TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    approved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS quotes_request_idx ON quotes(request_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK (amount > 0),
    note TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS payments_request_idx ON payments(request_id, received_at DESC);
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    position TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    resume_name TEXT,
    resume_pdf BLOB,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'contacted', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS applications_created_at_idx ON applications(created_at DESC);
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    supplier TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    stock_qty REAL NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    price_source TEXT NOT NULL DEFAULT 'manual' CHECK (price_source IN ('manual', 'invoice', 'csv', 'supplier_api')),
    supplier_url TEXT NOT NULL DEFAULT '',
    supplier_store TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    price_checked_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS materials_name_idx ON materials(name);
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    quantity_change REAL NOT NULL CHECK (quantity_change != 0),
    note TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS inventory_movements_created_at_idx ON inventory_movements(created_at DESC);
`);

const quoteColumns = new Set((database.pragma('table_info(quotes)') as Array<{ name: string }>).map((column) => column.name));
for (const [column, definition] of [
  ['cost_subtotal', 'REAL NOT NULL DEFAULT 0'],
  ['margin_percent', 'REAL NOT NULL DEFAULT 25'],
  ['gross_profit', 'REAL NOT NULL DEFAULT 0'],
  ['public_token', 'TEXT'],
  ['approval_status', "TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected'))"],
  ['approved_at', 'TEXT'],
] as const) {
  if (!quoteColumns.has(column)) database.exec(`ALTER TABLE quotes ADD COLUMN ${column} ${definition}`);
}
const materialColumns = new Set((database.pragma('table_info(materials)') as Array<{ name: string }>).map((column) => column.name));
for (const [column, definition] of [
  ['supplier_url', "TEXT NOT NULL DEFAULT ''"],
  ['supplier_store', "TEXT NOT NULL DEFAULT ''"],
  ['image_url', "TEXT NOT NULL DEFAULT ''"],
  ['price_checked_at', 'TEXT'],
  ['archived_at', 'TEXT'],
] as const) {
  if (!materialColumns.has(column)) database.exec(`ALTER TABLE materials ADD COLUMN ${column} ${definition}`);
}
// SQLite cannot alter a CHECK constraint, so older databases get the requests table rebuilt
// with foreign keys off; otherwise dropping it would cascade-delete quotes and follow-ups.
const requestsTableSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'").get() as { sql: string }).sql;
if (!requestsTableSql.includes("'in_progress'")) {
  database.pragma('foreign_keys = OFF');
  database.transaction(() => {
    database.exec(`
      CREATE TABLE requests_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        project_type TEXT NOT NULL,
        property_address TEXT NOT NULL,
        preferred_meeting TEXT NOT NULL DEFAULT '',
        ideal_start TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'scheduled', 'in_progress', 'declined')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO requests_new (id, name, email, phone, project_type, property_address, preferred_meeting, ideal_start, message, status, created_at)
        SELECT id, name, email, phone, project_type, property_address, preferred_meeting, ideal_start, message, status, created_at FROM requests;
      DROP TABLE requests;
      ALTER TABLE requests_new RENAME TO requests;
      CREATE INDEX IF NOT EXISTS requests_created_at_idx ON requests(created_at DESC);
    `);
    const violations = database.pragma('foreign_key_check') as unknown[];
    if (violations.length) throw new Error('Requests migration left orphaned rows; rolled back.');
  })();
  database.pragma('foreign_keys = ON');
}
// Payments are never deleted: refunds are their own rows and mistakes are voided with a reason.
const paymentColumns = new Set((database.pragma('table_info(payments)') as Array<{ name: string }>).map((column) => column.name));
for (const [column, definition] of [
  ['kind', "TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund'))"],
  ['voided_at', 'TEXT'],
  ['voided_by', 'TEXT'],
  ['void_reason', 'TEXT'],
] as const) {
  if (!paymentColumns.has(column)) database.exec(`ALTER TABLE payments ADD COLUMN ${column} ${definition}`);
}
database.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('payroll', 'subcontractor', 'materials', 'equipment', 'vehicle', 'office', 'insurance', 'other')),
    description TEXT NOT NULL,
    paid_to TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL CHECK (amount > 0),
    request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,
    recorded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    voided_at TEXT,
    voided_by TEXT,
    void_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(expense_date DESC);
`);

// Server and browser errors, shown on the admin Health page.
database.exec(`
  CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK (source IN ('server', 'client')),
    message TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS error_log_created_idx ON error_log(created_at DESC);
`);

// Email confirmation for public requests. Requests that existed before this feature count as confirmed.
const requestColumns = new Set((database.pragma('table_info(requests)') as Array<{ name: string }>).map((column) => column.name));
if (!requestColumns.has('email_verified_at')) {
  database.exec('ALTER TABLE requests ADD COLUMN email_verified_at TEXT');
  database.exec('UPDATE requests SET email_verified_at = created_at');
}
if (!requestColumns.has('verify_token_hash')) database.exec('ALTER TABLE requests ADD COLUMN verify_token_hash TEXT');
if (!requestColumns.has('verify_expires_at')) database.exec('ALTER TABLE requests ADD COLUMN verify_expires_at INTEGER');
// Site meeting status lets staff mark a customer's meeting as postponed, done or cancelled from the calendar.
if (!requestColumns.has('meeting_status')) {
  database.exec("ALTER TABLE requests ADD COLUMN meeting_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (meeting_status IN ('scheduled', 'postponed', 'done', 'cancelled'))");
}
// Kept so later texts (meeting changes, quote ready) only go to customers who opted in.
if (!requestColumns.has('sms_consent')) database.exec('ALTER TABLE requests ADD COLUMN sms_consent INTEGER NOT NULL DEFAULT 0');
if (!requestColumns.has('meeting_note')) database.exec("ALTER TABLE requests ADD COLUMN meeting_note TEXT NOT NULL DEFAULT ''");
database.exec(`
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('site_meeting', 'job', 'delivery', 'inspection', 'other')),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'postponed', 'done', 'cancelled')),
    note TEXT NOT NULL DEFAULT '',
    request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(event_date);
`);
database.exec('CREATE INDEX IF NOT EXISTS requests_verify_token_idx ON requests(verify_token_hash) WHERE verify_token_hash IS NOT NULL');
database.exec('CREATE UNIQUE INDEX IF NOT EXISTS quotes_public_token_idx ON quotes(public_token) WHERE public_token IS NOT NULL');

database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

export async function seedOwner(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const userCount = (database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;

  if (userCount !== 0 || !email || !password) return;
  const minimumLength = process.env.NODE_ENV === 'development' ? 8 : 12;
  if (password.length < minimumLength) {
    throw new Error(`ADMIN_PASSWORD must contain at least ${minimumLength} characters when creating the initial owner.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .run(randomUUID(), email, passwordHash);
  console.info(`Created initial owner account for ${email}`);
}

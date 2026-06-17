const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, '..', 'data.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT,
    role TEXT NOT NULL DEFAULT 'delivery',
    pin TEXT NOT NULL DEFAULT '0000',
    tab_overrides TEXT NOT NULL DEFAULT '{"add":[],"remove":[]}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'marketing',
    lead_name TEXT,
    sales_name TEXT,
    posts_target INTEGER NOT NULL DEFAULT 0,
    posts_actual INTEGER NOT NULL DEFAULT 0,
    next_shoot_date TEXT,
    health_score INTEGER NOT NULL DEFAULT 100,
    contract_value REAL NOT NULL DEFAULT 0,
    retainer_amount REAL NOT NULL DEFAULT 0,
    contract_status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    category TEXT,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    expense_date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deliverables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Reel',
    status TEXT NOT NULL DEFAULT 'pending_approval',
    comment_count INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    creative_lead TEXT,
    content_type TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    assignee TEXT,
    event_date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'production',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (name, title, role, pin) VALUES (?, ?, ?, ?)'
    );
    insertUser.run('Julius', 'Sales Director / CEO', 'admin', '0000');
    insertUser.run('Evangeline', 'Operations Director / COO', 'admin', '0000');
  }

  const clientCount = db.prepare('SELECT COUNT(*) AS count FROM clients').get().count;
  if (clientCount === 0) {
    const insertClient = db.prepare(`
      INSERT INTO clients
        (number, name, type, lead_name, sales_name, posts_target, posts_actual, next_shoot_date, health_score, contract_value, retainer_amount, contract_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertClient.run(1, 'Rebuild 2', 'branding', null, 'Eunice', 1, 0, null, 8, 4000, 0, 'active');
    insertClient.run(2, 'Bold Collectives', 'branding', 'Nigel', 'Nigel', 3, 0, null, 8, 5000, 2500, 'active');
    insertClient.run(3, 'Butler Interior', 'marketing', 'Hans', 'Nigel', 3, 0, null, 31, 4500, 4500, 'active');
    insertClient.run(4, 'Curated Co', 'branding', null, 'Nigel', 0, 0, null, 23, 0, 0, 'pending');
    insertClient.run(5, 'Dreamcatcher Interior Design', 'branding', 'Noel', 'Shawn', 3, 0, null, 8, 3500, 0, 'active');
    insertClient.run(6, 'EFR Design', 'marketing', 'Hans', 'Nigel', 1, 0, null, 7, 2800, 0, 'active');
    insertClient.run(7, 'El Arte Design', 'marketing', null, null, 0, 0, null, 52, 0, 0, 'pending');
    insertClient.run(8, 'Empyrean Design Studio', 'marketing', 'Noel', 'Shawn', 0, 0, null, 40, 0, 0, 'pending');
    insertClient.run(9, 'Flo Design', 'branding', 'Hans', 'Nigel', 1, 0, null, 45, 3000, 0, 'active');
  }
}

seedIfEmpty();

module.exports = db;

const express = require('express');
const path = require('node:path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const ROLE_TABS = {
  admin: ['dashboard', 'clients', 'calendar', 'tasks', 'deliverables', 'library', 'studio', 'accounting', 'admin'],
  sales: ['dashboard', 'clients', 'calendar', 'tasks', 'accounting'],
  delivery: ['dashboard', 'clients', 'calendar', 'tasks', 'deliverables', 'library', 'studio'],
};

function tabsForUser(user) {
  const base = new Set(ROLE_TABS[user.role] || []);
  let overrides = { add: [], remove: [] };
  try { overrides = JSON.parse(user.tab_overrides || '{}'); } catch { /* ignore malformed override */ }
  (overrides.add || []).forEach(t => base.add(t));
  (overrides.remove || []).forEach(t => base.delete(t));
  return Array.from(base);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    role: user.role,
    tabs: tabsForUser(user),
  };
}

function healthStatus(score) {
  if (score <= 30) return 'CRITICAL';
  if (score <= 60) return 'WATCH';
  return 'HEALTHY';
}

// ---- Auth ----

app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, name, title, role FROM users ORDER BY id ASC').all();
  res.json(users);
});

app.post('/api/login', (req, res) => {
  const { userId, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.pin !== String(pin || '')) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }
  res.json(publicUser(user));
});

app.post('/api/users/:id/pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user || user.pin !== String(currentPin || '')) {
    return res.status(401).json({ error: 'Incorrect current PIN' });
  }
  if (!/^\d{4}$/.test(String(newPin || ''))) {
    return res.status(400).json({ error: 'New PIN must be 4 digits' });
  }
  db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(newPin, req.params.id);
  res.json({ ok: true });
});

// ---- Admin: user + permission management ----

app.post('/api/admin/users', (req, res) => {
  const { name, title = '', role = 'delivery' } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'INSERT INTO users (name, title, role, pin) VALUES (?, ?, ?, ?)'
  ).run(String(name).trim(), title, role, '0000');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(publicUser(user));
});

app.get('/api/admin/users', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
  res.json(users.map(publicUser));
});

app.put('/api/admin/users/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const role = req.body.role !== undefined ? req.body.role : existing.role;
  const title = req.body.title !== undefined ? req.body.title : existing.title;
  const tabOverrides = req.body.tabOverrides !== undefined
    ? JSON.stringify(req.body.tabOverrides)
    : existing.tab_overrides;
  db.prepare('UPDATE users SET role = ?, title = ?, tab_overrides = ? WHERE id = ?')
    .run(role, title, tabOverrides, req.params.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json(publicUser(updated));
});

app.delete('/api/admin/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.get('/api/admin/tabs', (req, res) => {
  const allTabs = Array.from(new Set(Object.values(ROLE_TABS).flat()));
  res.json({ allTabs, roleTabs: ROLE_TABS });
});

// ---- Clients ----

app.get('/api/clients', (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY number ASC').all();
  res.json(clients.map(c => ({ ...c, health_status: healthStatus(c.health_score) })));
});

app.post('/api/clients', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const maxNumber = db.prepare('SELECT COALESCE(MAX(number), 0) AS max FROM clients').get().max;
  const {
    type = 'marketing', lead_name = null, sales_name = null, posts_target = 0,
    next_shoot_date = null, contract_value = 0, retainer_amount = 0, contract_status = 'active',
  } = req.body;
  const result = db.prepare(`
    INSERT INTO clients (number, name, type, lead_name, sales_name, posts_target, next_shoot_date, health_score, contract_value, retainer_amount, contract_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?)
  `).run(maxNumber + 1, name, type, lead_name, sales_name, posts_target, next_shoot_date, contract_value, retainer_amount, contract_status);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...client, health_status: healthStatus(client.health_score) });
});

app.put('/api/clients/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = [
    'name', 'type', 'lead_name', 'sales_name', 'posts_target', 'posts_actual',
    'next_shoot_date', 'health_score', 'contract_value', 'retainer_amount', 'contract_status',
  ];
  const merged = {};
  fields.forEach(f => { merged[f] = req.body[f] !== undefined ? req.body[f] : existing[f]; });
  db.prepare(`
    UPDATE clients SET name=?, type=?, lead_name=?, sales_name=?, posts_target=?, posts_actual=?,
      next_shoot_date=?, health_score=?, contract_value=?, retainer_amount=?, contract_status=?
    WHERE id = ?
  `).run(
    merged.name, merged.type, merged.lead_name, merged.sales_name, merged.posts_target, merged.posts_actual,
    merged.next_shoot_date, merged.health_score, merged.contract_value, merged.retainer_amount, merged.contract_status,
    req.params.id
  );
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json({ ...client, health_status: healthStatus(client.health_score) });
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Expenses & accounting ----

app.get('/api/expenses', (req, res) => {
  const expenses = db.prepare(`
    SELECT e.*, c.name AS client_name FROM expenses e
    LEFT JOIN clients c ON c.id = e.client_id
    ORDER BY e.expense_date DESC, e.id DESC
  `).all();
  res.json(expenses);
});

app.post('/api/expenses', (req, res) => {
  const description = String(req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Description is required' });
  const { amount = 0, category = 'General', client_id = null, expense_date = null } = req.body;
  const result = db.prepare(`
    INSERT INTO expenses (description, amount, category, client_id, expense_date)
    VALUES (?, ?, ?, ?, COALESCE(?, date('now')))
  `).run(description, amount, category, client_id, expense_date);
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(expense);
});

app.delete('/api/expenses/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.get('/api/accounting/summary', (req, res) => {
  const revenue = db.prepare(`
    SELECT COALESCE(SUM(contract_value), 0) AS contracts, COALESCE(SUM(retainer_amount), 0) AS retainers
    FROM clients WHERE contract_status = 'active'
  `).get();
  const totalExpenses = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses').get().total;
  const byCategory = db.prepare(`
    SELECT COALESCE(category, 'General') AS category, SUM(amount) AS total
    FROM expenses GROUP BY category ORDER BY total DESC
  `).all();
  const grossRevenue = revenue.contracts + revenue.retainers;
  res.json({
    grossRevenue,
    contractRevenue: revenue.contracts,
    retainerRevenue: revenue.retainers,
    totalExpenses,
    grossProfit: grossRevenue - totalExpenses,
    byCategory,
  });
});

// ---- Deliverables ----

app.get('/api/deliverables', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, c.name AS client_name FROM deliverables d
    LEFT JOIN clients c ON c.id = d.client_id
    ORDER BY d.client_id ASC, d.position ASC, d.id ASC
  `).all();
  res.json(rows);
});

app.post('/api/deliverables', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const { client_id = null, type = 'Reel', status = 'pending_approval' } = req.body;
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM deliverables WHERE client_id = ?').get(client_id).max;
  const result = db.prepare(`
    INSERT INTO deliverables (client_id, title, type, status, position) VALUES (?, ?, ?, ?, ?)
  `).run(client_id, title, type, status, maxPos + 1);
  const row = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.put('/api/deliverables/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const title = req.body.title !== undefined ? req.body.title : existing.title;
  const type = req.body.type !== undefined ? req.body.type : existing.type;
  const status = req.body.status !== undefined ? req.body.status : existing.status;
  db.prepare('UPDATE deliverables SET title = ?, type = ?, status = ? WHERE id = ?')
    .run(title, type, status, req.params.id);
  res.json(db.prepare('SELECT * FROM deliverables WHERE id = ?').get(req.params.id));
});

app.delete('/api/deliverables/:id', (req, res) => {
  db.prepare('DELETE FROM deliverables WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Tasks ----

app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, c.name AS client_name FROM tasks t
    LEFT JOIN clients c ON c.id = t.client_id
    ORDER BY t.position ASC, t.id ASC
  `).all();
  res.json(rows);
});

app.post('/api/tasks', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const {
    client_id = null, creative_lead = null, content_type = 'Static',
    due_date = null, priority = 'normal', status = 'planned',
  } = req.body;
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM tasks').get().max;
  const result = db.prepare(`
    INSERT INTO tasks (client_id, title, creative_lead, content_type, due_date, priority, status, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client_id, title, creative_lead, content_type, due_date, priority, status, maxPos + 1);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/tasks/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fields = ['title', 'creative_lead', 'content_type', 'due_date', 'priority', 'status', 'client_id'];
  const merged = {};
  fields.forEach(f => { merged[f] = req.body[f] !== undefined ? req.body[f] : existing[f]; });
  db.prepare(`
    UPDATE tasks SET title=?, creative_lead=?, content_type=?, due_date=?, priority=?, status=?, client_id=?
    WHERE id = ?
  `).run(merged.title, merged.creative_lead, merged.content_type, merged.due_date, merged.priority, merged.status, merged.client_id, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Calendar ----

app.get('/api/calendar-events', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, c.name AS client_name FROM calendar_events e
    LEFT JOIN clients c ON c.id = e.client_id
    ORDER BY e.event_date ASC
  `).all();
  res.json(rows);
});

app.post('/api/calendar-events', (req, res) => {
  const title = String(req.body.title || '').trim();
  const event_date = req.body.event_date;
  if (!title || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  const { client_id = null, assignee = null, type = 'production' } = req.body;
  const result = db.prepare(`
    INSERT INTO calendar_events (client_id, title, assignee, event_date, type) VALUES (?, ?, ?, ?, ?)
  `).run(client_id, title, assignee, event_date, type);
  res.status(201).json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/calendar-events/:id', (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Dashboard ----

app.get('/api/dashboard', (req, res) => {
  const clients = db.prepare('SELECT * FROM clients').all();
  const activeClients = clients.filter(c => c.contract_status === 'active').length;
  const postsThisWeekActual = clients.reduce((sum, c) => sum + c.posts_actual, 0);
  const postsThisWeekTarget = clients.reduce((sum, c) => sum + c.posts_target, 0);
  const shootsThisMonth = db.prepare(`
    SELECT COUNT(*) AS count FROM calendar_events
    WHERE type = 'shoot' AND strftime('%Y-%m', event_date) = strftime('%Y-%m', 'now')
  `).get().count;
  const criticalClients = clients.filter(c => c.health_score <= 30).length;
  res.json({
    activeClients,
    postsThisWeek: { actual: postsThisWeekActual, target: postsThisWeekTarget },
    postsThisMonth: { actual: postsThisWeekActual, target: postsThisWeekTarget },
    shootsThisMonth,
    criticalClients,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Operations app listening on http://localhost:${PORT}`));

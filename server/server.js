const express = require('express');
const path = require('node:path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Clients ----

app.get('/api/clients', (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY name ASC').all();
  res.json(clients);
});

app.post('/api/clients', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare('INSERT INTO clients (name) VALUES (?)').run(name);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(client);
});

app.put('/api/clients/:id', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(name, req.params.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Tasks ----

app.get('/api/tasks', (req, res) => {
  const { client_id } = req.query;
  const tasks = client_id
    ? db.prepare('SELECT * FROM tasks WHERE client_id = ? ORDER BY position ASC, id ASC').all(client_id)
    : db.prepare('SELECT * FROM tasks ORDER BY position ASC, id ASC').all();
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const { client_id = null, notes = '', due_date = null } = req.body;
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM tasks').get().max;
  const result = db.prepare(
    'INSERT INTO tasks (client_id, title, notes, due_date, position) VALUES (?, ?, ?, ?, ?)'
  ).run(client_id, title, notes, due_date, maxPos + 1);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const title = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;
  const due_date = req.body.due_date !== undefined ? req.body.due_date : existing.due_date;
  const status = req.body.status !== undefined ? req.body.status : existing.status;
  const client_id = req.body.client_id !== undefined ? req.body.client_id : existing.client_id;
  db.prepare(
    'UPDATE tasks SET title = ?, notes = ?, due_date = ?, status = ?, client_id = ? WHERE id = ?'
  ).run(title, notes, due_date, status, client_id, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---- Overview ----

app.get('/api/overview', (req, res) => {
  const clientCount = db.prepare('SELECT COUNT(*) AS count FROM clients').get().count;
  const openTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'").get().count;
  const doneTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'done'").get().count;
  const dueSoon = db.prepare(
    "SELECT t.*, c.name AS client_name FROM tasks t LEFT JOIN clients c ON c.id = t.client_id " +
    "WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != '' " +
    "ORDER BY t.due_date ASC LIMIT 8"
  ).all();
  res.json({ clientCount, openTasks, doneTasks, dueSoon });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Operations app listening on http://localhost:${PORT}`));

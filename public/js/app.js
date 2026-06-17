const state = {
    clients: [],
    tasks: [],
    calendarMonth: new Date(),
};

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function showToast(message) {
    const container = qs('#toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed');
    }
    if (res.status === 204) return null;
    return res.json();
}

async function loadAll() {
    state.clients = await api('/api/clients');
    state.tasks = await api('/api/tasks');
}

function clientName(id) {
    const client = state.clients.find(c => c.id === id);
    return client ? client.name : 'Unassigned';
}

// ---- Navigation ----

function initNavigation() {
    qsa('[data-nav]').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.nav;
            qsa('[data-nav]').forEach(b => b.classList.toggle('active', b === button));
            qsa('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + target));
            renderScreen(target);
        });
    });
}

function renderScreen(name) {
    if (name === 'overview') renderOverview();
    if (name === 'clients') renderClients();
    if (name === 'calendar') renderCalendar();
    if (name === 'tasks') renderTasks();
}

// ---- Overview ----

async function renderOverview() {
    const root = qs('#screen-overview');
    const overview = await api('/api/overview');
    root.innerHTML = `
        <div class="section-header">
            <h1>Overview</h1>
            <p>Snapshot of clients and tasks across the team</p>
        </div>
        <div class="grid grid-3">
            <div class="card stat-card"><span>Clients</span><strong>${overview.clientCount}</strong></div>
            <div class="card stat-card"><span>Open tasks</span><strong>${overview.openTasks}</strong></div>
            <div class="card stat-card"><span>Completed tasks</span><strong>${overview.doneTasks}</strong></div>
        </div>
        <div class="card" style="margin-top:20px">
            <h3>Due soon</h3>
            <div class="list">
                ${overview.dueSoon.length ? overview.dueSoon.map(t => `
                    <div class="list-row">
                        <div class="list-row-main">
                            <div>
                                <div class="list-row-title">${escapeHtml(t.title)}</div>
                                <div class="list-row-meta">${escapeHtml(t.client_name || 'Unassigned')} - due ${escapeHtml(t.due_date)}</div>
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="empty-state">No upcoming due dates</div>'}
            </div>
        </div>
    `;
}

// ---- Clients ----

function renderClients() {
    const root = qs('#screen-clients');
    root.innerHTML = `
        <div class="section-header">
            <h1>Clients</h1>
            <p>Manage the client roster</p>
        </div>
        <div class="list" id="clients-list"></div>
        <div class="inline-form">
            <input type="text" id="new-client-name" placeholder="New client name">
            <button class="btn btn-primary" id="add-client-btn" type="button">Add client</button>
        </div>
    `;

    function paintList() {
        const list = qs('#clients-list');
        list.innerHTML = state.clients.length ? state.clients.map(c => `
            <div class="list-row" data-id="${c.id}">
                <div class="list-row-main">
                    <div class="list-row-title">${escapeHtml(c.name)}</div>
                </div>
                <div class="list-row-actions">
                    <button class="btn btn-sm" data-action="rename">Rename</button>
                    <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
                </div>
            </div>
        `).join('') : '<div class="empty-state">No clients yet</div>';
    }
    paintList();

    qs('#add-client-btn').addEventListener('click', async () => {
        const input = qs('#new-client-name');
        const name = input.value.trim();
        if (!name) return showToast('Name is required');
        const client = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name }) });
        state.clients.push(client);
        input.value = '';
        paintList();
        showToast('Client added');
    });

    qs('#clients-list').addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const row = button.closest('.list-row');
        const id = Number(row.dataset.id);
        const client = state.clients.find(c => c.id === id);

        if (button.dataset.action === 'delete') {
            await api(`/api/clients/${id}`, { method: 'DELETE' });
            state.clients = state.clients.filter(c => c.id !== id);
            paintList();
            showToast('Client removed');
        }
        if (button.dataset.action === 'rename') {
            const name = prompt('Rename client', client.name);
            if (!name || !name.trim()) return;
            const updated = await api(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
            client.name = updated.name;
            paintList();
            showToast('Client updated');
        }
    });
}

// ---- Tasks ----

function renderTasks() {
    const root = qs('#screen-tasks');
    const clientOptions = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    root.innerHTML = `
        <div class="section-header">
            <h1>Task</h1>
            <p>Track work across all clients</p>
        </div>
        <div class="list" id="tasks-list"></div>
        <div class="inline-form">
            <input type="text" id="new-task-title" placeholder="New task">
            <select id="new-task-client"><option value="">Unassigned</option>${clientOptions}</select>
            <input type="date" id="new-task-due">
            <button class="btn btn-primary" id="add-task-btn" type="button">Add task</button>
        </div>
    `;

    function paintList() {
        const list = qs('#tasks-list');
        list.innerHTML = state.tasks.length ? state.tasks.map(t => `
            <div class="list-row ${t.status === 'done' ? 'is-done' : ''}" data-id="${t.id}">
                <div class="list-row-main">
                    <input type="checkbox" data-action="toggle" ${t.status === 'done' ? 'checked' : ''}>
                    <div>
                        <div class="list-row-title">${escapeHtml(t.title)}</div>
                        <div class="list-row-meta">${escapeHtml(clientName(t.client_id))}${t.due_date ? ' - due ' + escapeHtml(t.due_date) : ''}</div>
                    </div>
                </div>
                <div class="list-row-actions">
                    <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
                </div>
            </div>
        `).join('') : '<div class="empty-state">No tasks yet</div>';
    }
    paintList();

    qs('#add-task-btn').addEventListener('click', async () => {
        const titleInput = qs('#new-task-title');
        const clientSelect = qs('#new-task-client');
        const dueInput = qs('#new-task-due');
        const title = titleInput.value.trim();
        if (!title) return showToast('Title is required');
        const task = await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
                title,
                client_id: clientSelect.value ? Number(clientSelect.value) : null,
                due_date: dueInput.value || null,
            }),
        });
        state.tasks.push(task);
        titleInput.value = '';
        dueInput.value = '';
        paintList();
        showToast('Task added');
    });

    qs('#tasks-list').addEventListener('click', async event => {
        const target = event.target;
        const row = target.closest('.list-row');
        if (!row) return;
        const id = Number(row.dataset.id);
        const task = state.tasks.find(t => t.id === id);

        if (target.matches('[data-action="toggle"]')) {
            const status = target.checked ? 'done' : 'open';
            const updated = await api(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            task.status = updated.status;
            paintList();
        }
        const button = target.closest('button[data-action="delete"]');
        if (button) {
            await api(`/api/tasks/${id}`, { method: 'DELETE' });
            state.tasks = state.tasks.filter(t => t.id !== id);
            paintList();
            showToast('Task removed');
        }
    });
}

// ---- Calendar ----

function renderCalendar() {
    const root = qs('#screen-calendar');
    root.innerHTML = `
        <div class="toolbar">
            <div class="section-header" style="margin-bottom:0">
                <h1>Calendar</h1>
                <p>Tasks by due date</p>
            </div>
            <div>
                <button class="btn btn-sm" id="cal-prev" type="button">&lt;</button>
                <strong id="cal-label" style="margin:0 8px"></strong>
                <button class="btn btn-sm" id="cal-next" type="button">&gt;</button>
            </div>
        </div>
        <div class="calendar-grid" id="cal-weekdays"></div>
        <div class="calendar-grid" id="cal-grid"></div>
    `;

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    qs('#cal-weekdays').innerHTML = weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join('');

    function paint() {
        const month = state.calendarMonth;
        qs('#cal-label').textContent = month.toLocaleString('default', { month: 'long', year: 'numeric' });

        const year = month.getFullYear();
        const monthIndex = month.getMonth();
        const firstDay = new Date(year, monthIndex, 1).getDay();
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

        const tasksByDay = {};
        state.tasks.forEach(t => {
            if (!t.due_date) return;
            const d = new Date(t.due_date);
            if (d.getFullYear() === year && d.getMonth() === monthIndex) {
                const day = d.getDate();
                tasksByDay[day] = tasksByDay[day] || [];
                tasksByDay[day].push(t);
            }
        });

        let cells = '';
        for (let i = 0; i < firstDay; i++) cells += '<div class="calendar-cell is-empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
            const tasks = tasksByDay[day] || [];
            cells += `
                <div class="calendar-cell">
                    <div class="day-num">${day}</div>
                    ${tasks.map(t => `<div class="calendar-task">${escapeHtml(t.title)}</div>`).join('')}
                </div>
            `;
        }
        qs('#cal-grid').innerHTML = cells;
    }

    qs('#cal-prev').addEventListener('click', () => {
        state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
        paint();
    });
    qs('#cal-next').addEventListener('click', () => {
        state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
        paint();
    });

    paint();
}

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    await loadAll();
    renderOverview();
});

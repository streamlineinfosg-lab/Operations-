const state = {
    currentUser: null,
    pendingUser: null,
    pinDigits: '',
    pinMode: 'login', // 'login' | 'change'
    users: [],
    clients: [],
    tasks: [],
    deliverables: [],
    events: [],
    calendarMonth: new Date(),
    studioMetric: 'leads',
    deliverableFilter: 'all',
    taskFilter: 'all',
    clientFilter: 'all',
    dashboardPanel: null,
    reviewForm: { sentiment: 'neutral' },
    updateForm: { status: 'on_track' },
};

const TAB_LABELS = {
    dashboard: 'Dashboard', clients: 'Clients', calendar: 'Calendar', tasks: 'Tasks',
    deliverables: 'Deliverables', library: 'Library', studio: 'Studio',
    accounting: 'Accounting', admin: 'Admin',
};

const NAV_GROUPS = [
    { label: 'Workspace', tabs: ['dashboard', 'clients', 'calendar', 'tasks'] },
    { label: 'Sales', tabs: ['accounting'] },
    { label: 'Delivery', tabs: ['deliverables', 'library', 'studio'] },
    { label: 'Admin', tabs: ['admin'] },
];

function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}
function money(value) { return '$' + Math.round(Number(value) || 0).toLocaleString(); }

function showToast(message) {
    const container = qs('#toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
}

function showModal(content) {
    const container = qs('#modal-container');
    container.innerHTML = `<div class="modal-backdrop"><div class="modal-content">${content}</div></div>`;
    const backdrop = qs('.modal-backdrop', container);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    qsa('[data-modal-close]', container).forEach(el => el.addEventListener('click', closeModal));
}
function closeModal() { qs('#modal-container').innerHTML = ''; }

async function api(path, options = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed');
    }
    if (res.status === 204) return null;
    return res.json();
}

function clientById(id) { return state.clients.find(c => c.id === id); }

// ---- User ID / PIN / Login ----

async function initCheckin() {
    state.users = await api('/api/users');
    qs('#userid-input').value = '';
    qs('#userid-error').textContent = '';
}

qs('#userid-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = qs('#userid-input').value.trim();
    if (!name) return;
    const user = state.users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (!user) {
        qs('#userid-error').textContent = 'No team member found with that name.';
        return;
    }
    openPinScreen(user.id, 'login');
});

function openPinScreen(userId, mode) {
    const user = state.users.find(u => u.id === userId) || state.currentUser;
    state.pendingUser = user;
    state.pinMode = mode;
    state.pinDigits = '';
    qs('#pin-name').textContent = user.name;
    qs('#pin-title').textContent = mode === 'change' ? 'Enter current PIN' : (user.title || '').toUpperCase();
    qs('#pin-error').textContent = '';
    paintPinDots();
    paintPinPad();
    switchScreen('screen-pin');
}

function paintPinDots() {
    qsa('#pin-dots span').forEach((dot, i) => dot.classList.toggle('filled', i < state.pinDigits.length));
}

function paintPinPad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '0', 'OK'];
    qs('#pin-pad').innerHTML = keys.map(k => `<button class="login-key" data-key="${k}" type="button">${k}</button>`).join('');
    qsa('.login-key', qs('#pin-pad')).forEach(btn => btn.addEventListener('click', () => handlePinKey(btn.dataset.key)));
}

function handlePinKey(key) {
    if (key === '<') {
        state.pinDigits = state.pinDigits.slice(0, -1);
        paintPinDots();
        return;
    }
    if (key === 'OK') {
        if (state.pinDigits.length === 4) submitPin();
        return;
    }
    if (state.pinDigits.length < 4) {
        state.pinDigits += key;
        paintPinDots();
        if (state.pinDigits.length === 4) submitPin();
    }
}

async function submitPin() {
    const pin = state.pinDigits;
    try {
        if (state.pinMode === 'login') {
            const user = await api('/api/login', { method: 'POST', body: JSON.stringify({ userId: state.pendingUser.id, pin }) });
            state.currentUser = user;
            await enterApp();
        } else if (state.pinMode === 'change-current') {
            state.changeCurrentPin = pin;
            state.pinMode = 'change-new';
            state.pinDigits = '';
            qs('#pin-title').textContent = 'Enter new 4-digit PIN';
            paintPinDots();
        } else if (state.pinMode === 'change-new') {
            await api(`/api/users/${state.currentUser.id}/pin`, {
                method: 'POST',
                body: JSON.stringify({ currentPin: state.changeCurrentPin, newPin: pin }),
            });
            showToast('PIN updated');
            switchScreen(null);
            qs('#app-layout').classList.add('active');
        }
    } catch (err) {
        qs('#pin-error').textContent = err.message;
        state.pinDigits = '';
        paintPinDots();
    }
}

qs('#pin-back').addEventListener('click', () => {
    if (state.currentUser) {
        switchScreen(null);
        qs('#app-layout').classList.add('active');
    } else {
        state.pinDigits = '';
        switchScreen('screen-userid');
    }
});

function switchScreen(id) {
    qsa('.screen').forEach(s => s.classList.remove('active'));
    qs('#app-layout').classList.remove('active');
    if (id) qs('#' + id).classList.add('active');
}

async function enterApp() {
    switchScreen(null);
    qs('#app-layout').classList.add('active');
    qs('#nav-user').textContent = state.currentUser.name;
    qs('#nav-footer-avatar').textContent = state.currentUser.name.slice(0, 1).toUpperCase();
    paintNav();
    await loadAll();
    const firstTab = state.currentUser.tabs[0] || 'dashboard';
    goToTab(firstTab);
}

function paintNav() {
    const root = qs('#nav-items');
    const allowed = new Set(state.currentUser.tabs);
    root.innerHTML = NAV_GROUPS.map(group => {
        const tabs = group.tabs.filter(t => allowed.has(t));
        if (!tabs.length) return '';
        return `
            <div class="nav-group">
                <div class="nav-group-label">${escapeHtml(group.label)}</div>
                ${tabs.map(tab => `
                    <button class="nav-item" data-tab="${tab}" type="button">${TAB_LABELS[tab] || tab}</button>
                `).join('')}
            </div>
        `;
    }).join('');
    qsa('[data-tab]', root).forEach(btn => btn.addEventListener('click', () => goToTab(btn.dataset.tab)));
}

function goToTab(tab) {
    qsa('#nav-items .nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    qsa('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
    const renderers = {
        dashboard: renderDashboard, clients: renderClients, calendar: renderCalendar,
        tasks: renderTasks, deliverables: renderDeliverables, library: renderLibrary,
        studio: renderStudio, accounting: renderAccounting, admin: renderAdmin,
    };
    (renderers[tab] || (() => {}))();
}

qs('#logout-btn').addEventListener('click', () => {
    state.currentUser = null;
    switchScreen('screen-userid');
    initCheckin();
});

qs('#change-pin-btn').addEventListener('click', () => {
    openPinScreen(state.currentUser.id, 'change-current');
});

async function loadAll() {
    [state.clients, state.tasks, state.deliverables, state.events] = await Promise.all([
        api('/api/clients'), api('/api/tasks'), api('/api/deliverables'), api('/api/calendar-events'),
    ]);
}

// ---- Dashboard ----

const SENTIMENT_OPTS = [['good', 'Good'], ['neutral', 'Neutral'], ['risk', 'At risk']];
const STATUS_OPTS = [['on_track', 'On track'], ['delayed', 'Delayed'], ['blocked', 'Blocked']];

async function renderDashboard() {
    const root = qs('#page-dashboard');
    const d = await api('/api/dashboard');
    state.dashboardData = d;
    if (!state.dashboardPanel) state.dashboardPanel = null;
    if (!state.reviewForm) state.reviewForm = { sentiment: 'neutral' };
    if (!state.updateForm) state.updateForm = { status: 'on_track' };

    const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

    root.innerHTML = `
        <div class="dash-heading">${todayLabel}</div>
        <h1 class="dash-title">Today, <em>attention needed.</em></h1>

        <div class="grid grid-4">
            <div class="card stat-card"><span>Active Clients</span><strong>${d.activeClients}</strong></div>
            <div class="card stat-card"><span>Posts This Week</span><strong>${d.postsThisWeek.actual}/${d.postsThisWeek.target}</strong></div>
            <div class="card stat-card"><span>Posts This Month</span><strong style="color:#a9700a">${d.postsThisMonth.actual}/${d.postsThisMonth.target}</strong></div>
            <div class="card stat-card"><span>Critical Clients</span><strong style="color:var(--accent)">${d.criticalClients}</strong></div>
        </div>

        <div class="action-cards">
            <div class="action-card ${state.dashboardPanel === 'review' ? 'active' : ''}" data-panel="review">
                <span class="icon">&#9998;</span>
                <div><h4>File a review</h4><p>Daily client check-in</p></div>
            </div>
            <div class="action-card ${state.dashboardPanel === 'update' ? 'active' : ''}" data-panel="update">
                <span class="icon">&#8635;</span>
                <div><h4>File an update</h4><p>Quick status note</p></div>
            </div>
            <div class="action-card ${state.dashboardPanel === 'suggest' ? 'active' : ''}" data-panel="suggest">
                <span class="icon">&#10022;</span>
                <div><h4>This week's focus</h4><p>AI · from reviews &amp; updates</p></div>
            </div>
        </div>

        <div id="dashboard-panel-slot"></div>

        <div class="feed-attention">
            <div>
                <div class="section-heading"><h2>Recent <em>activity.</em></h2><span>reviews &amp; updates</span></div>
                <div class="feed-list">
                    ${d.feed.length ? d.feed.map(f => `
                        <div class="feed-row">
                            <span class="feed-avatar">${escapeHtml(f.initials)}</span>
                            <div>
                                <div class="feed-top">
                                    <strong>${escapeHtml(f.client)}</strong>
                                    <span class="feed-tag" style="background:${f.tagBg};color:${f.tagColor}">${escapeHtml(f.status)}</span>
                                    <span class="feed-meta">${escapeHtml(f.member)} &middot; ${escapeHtml(f.time)}</span>
                                </div>
                                <div class="feed-note">${escapeHtml(f.note)}</div>
                            </div>
                        </div>
                    `).join('') : '<div class="suggest-empty">No activity filed yet.</div>'}
                </div>
            </div>
            <div>
                <div class="section-heading"><h2>Needs <em>attention.</em></h2></div>
                ${d.needsAttention.length ? d.needsAttention.map(c => `
                    <div class="attention-card">
                        <div class="attention-top"><strong>${escapeHtml(c.name)}</strong><strong style="color:${c.statusColor}">${c.health}</strong></div>
                        <div class="attention-bar"><div style="width:${c.pct}%;background:${c.bar}"></div></div>
                        <div class="attention-reason">${escapeHtml(c.reason)}</div>
                    </div>
                `).join('') : '<div class="suggest-empty">All clients healthy.</div>'}
            </div>
        </div>
    `;

    qsa('.action-card', root).forEach(card => {
        card.addEventListener('click', () => {
            const panel = card.dataset.panel;
            state.dashboardPanel = state.dashboardPanel === panel ? null : panel;
            renderDashboard();
        });
    });

    renderDashboardPanel();
}

function renderDashboardPanel() {
    const slot = qs('#dashboard-panel-slot');
    if (!slot) return;
    const d = state.dashboardData;
    const panel = state.dashboardPanel;

    if (panel === 'review') {
        slot.innerHTML = `
            <div class="section-heading"><h2>File a <em>review.</em></h2><span>daily client check-in</span></div>
            <div class="panel">
                <div class="panel-grid" style="grid-template-columns:1.7fr 1fr 1.4fr">
                    <div><label>Client</label><select id="rv-client">${state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
                    <div><label>Leads this week</label><input id="rv-leads" type="number" min="0" placeholder="0"></div>
                    <div><label>Next shoot</label><input id="rv-shoot" type="text" placeholder="e.g. Jun 24"></div>
                </div>
                <div style="margin-bottom:14px">
                    <label>Client sentiment</label>
                    <div class="chip-select" id="rv-sentiment">
                        ${SENTIMENT_OPTS.map(([v, l]) => `<div data-val="${v}" class="${state.reviewForm.sentiment === v ? 'sel-' + v : ''}">${l}</div>`).join('')}
                    </div>
                </div>
                <div class="panel-grid" style="grid-template-columns:1fr 1.4fr">
                    <div><label>Blockers / risks</label><input id="rv-blockers" placeholder="e.g. slow approvals"></div>
                    <div><label>Notes</label><input id="rv-notes" placeholder="What happened with this client today?"></div>
                </div>
                <button class="btn btn-primary" id="rv-submit" type="button">Submit review</button>
            </div>
        `;
        qsa('#rv-sentiment div', slot).forEach(chip => chip.addEventListener('click', () => {
            state.reviewForm.sentiment = chip.dataset.val;
            renderDashboardPanel();
        }));
        qs('#rv-submit', slot).addEventListener('click', async () => {
            await api('/api/reviews', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: Number(qs('#rv-client', slot).value),
                    member_name: state.currentUser.name,
                    leads: qs('#rv-leads', slot).value,
                    next_shoot: qs('#rv-shoot', slot).value.trim(),
                    sentiment: state.reviewForm.sentiment,
                    blockers: qs('#rv-blockers', slot).value.trim(),
                    notes: qs('#rv-notes', slot).value.trim(),
                }),
            });
            state.reviewForm = { sentiment: 'neutral' };
            state.dashboardPanel = null;
            showToast('Review submitted');
            renderDashboard();
        });
    } else if (panel === 'update') {
        slot.innerHTML = `
            <div class="section-heading"><h2>File an <em>update.</em></h2><span>quick status note</span></div>
            <div class="panel">
                <div class="panel-grid" style="grid-template-columns:1fr 1fr">
                    <div><label>Client</label><select id="up-client">${state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
                    <div>
                        <label>Status</label>
                        <div class="chip-select" id="up-status">
                            ${STATUS_OPTS.map(([v, l]) => `<div data-val="${v}" class="${state.updateForm.status === v ? 'sel-' + v : ''}">${l}</div>`).join('')}
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:14px"><label>What changed today?</label><input id="up-note" placeholder="e.g. client approved the reel batch"></div>
                <button class="btn btn-primary" id="up-submit" type="button">Post update</button>
            </div>
        `;
        qsa('#up-status div', slot).forEach(chip => chip.addEventListener('click', () => {
            state.updateForm.status = chip.dataset.val;
            renderDashboardPanel();
        }));
        qs('#up-submit', slot).addEventListener('click', async () => {
            await api('/api/updates', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: Number(qs('#up-client', slot).value),
                    member_name: state.currentUser.name,
                    status: state.updateForm.status,
                    note: qs('#up-note', slot).value.trim(),
                }),
            });
            state.updateForm = { status: 'on_track' };
            state.dashboardPanel = null;
            showToast('Update posted');
            renderDashboard();
        });
    } else if (panel === 'suggest') {
        slot.innerHTML = `
            <div class="section-heading"><h2>This week's <em>focus.</em></h2><span>AI &middot; from reviews &amp; updates</span></div>
            <div class="suggest-list">
                ${d.suggestions.length ? d.suggestions.map(s => `
                    <div class="suggest-row">
                        <span class="suggest-priority" style="background:${s.pBg};color:${s.pColor}">${escapeHtml(s.priority)}</span>
                        <div><strong style="font-size:13.5px">${escapeHtml(s.client)}</strong><div class="feed-note">${escapeHtml(s.action)}</div></div>
                    </div>
                `).join('') : '<div class="suggest-empty">No reviews filed in the last 7 days.</div>'}
            </div>
        `;
    } else {
        slot.innerHTML = '';
    }
}

// ---- Clients ----

function healthClass(score) { return score <= 30 ? 'is-critical' : ''; }

function renderClients() {
    const root = qs('#page-clients');
    root.innerHTML = `
        <div class="page-header">
            <div><h1 class="serif">All Clients</h1><p>${state.clients.length} total</p></div>
            <button class="btn btn-primary" id="add-client-btn" type="button">+ Request new client</button>
        </div>
        <div class="toolbar">
            <div class="tabs" id="client-filter-tabs">
                ${['all', 'marketing', 'branding'].map(f => `<button data-filter="${f}" class="${state.clientFilter === f ? 'active' : ''}">${f.toUpperCase()}</button>`).join('')}
            </div>
        </div>
        <div class="grid grid-3" id="clients-grid"></div>
    `;

    qsa('[data-filter]', qs('#client-filter-tabs')).forEach(btn => {
        btn.addEventListener('click', () => { state.clientFilter = btn.dataset.filter; renderClients(); });
    });

    const filtered = state.clients.filter(c => state.clientFilter === 'all' || c.type === state.clientFilter);
    const grid = qs('#clients-grid');
    grid.innerHTML = filtered.length ? filtered.map(c => `
        <div class="client-card ${healthClass(c.health_score)}" data-id="${c.id}">
            <span class="health-score ${healthClass(c.health_score)}">${c.health_score}/100</span>
            <div class="client-meta">${String(c.number).padStart(2, '0')} - ${c.type}</div>
            <h3>${escapeHtml(c.name)}</h3>
            <div class="client-row"><span>Posts this week</span><strong>${c.posts_actual}/${c.posts_target}</strong></div>
            <div class="client-row"><span>Lead</span><strong>${escapeHtml(c.lead_name || '-')}</strong></div>
            <div class="client-row"><span>Sales</span><strong>${escapeHtml(c.sales_name || '-')}</strong></div>
            <div class="client-row"><span>Next shoot</span><strong>${escapeHtml(c.next_shoot_date || '-')}</strong></div>
            <div class="health-bar-track"><div class="health-bar-fill ${healthClass(c.health_score)}" style="width:${c.health_score}%"></div></div>
        </div>
    `).join('') : '<div class="empty-state">No clients in this filter</div>';

    qs('#add-client-btn').addEventListener('click', openAddClientModal);
}

function openAddClientModal() {
    showModal(`
        <h2 class="serif">Request new client</h2>
        <form id="add-client-form">
            <div class="form-group"><label>Name</label><input type="text" name="name" required></div>
            <div class="form-group"><label>Type</label>
                <select name="type"><option value="marketing">Marketing</option><option value="branding">Branding</option></select>
            </div>
            <div class="form-group"><label>Lead</label><input type="text" name="lead_name"></div>
            <div class="form-group"><label>Sales owner</label><input type="text" name="sales_name"></div>
            <div class="form-group"><label>Contract value</label><input type="number" name="contract_value" value="0"></div>
            <div class="form-group"><label>Retainer / month</label><input type="number" name="retainer_amount" value="0"></div>
            <div class="modal-footer">
                <button type="button" class="btn" data-modal-close>Cancel</button>
                <button type="submit" class="btn btn-primary">Add</button>
            </div>
        </form>
    `);
    qs('#add-client-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.currentTarget;
        const client = await api('/api/clients', {
            method: 'POST',
            body: JSON.stringify({
                name: f.name.value.trim(), type: f.type.value, lead_name: f.lead_name.value.trim() || null,
                sales_name: f.sales_name.value.trim() || null,
                contract_value: Number(f.contract_value.value) || 0, retainer_amount: Number(f.retainer_amount.value) || 0,
            }),
        });
        state.clients.push(client);
        closeModal();
        renderClients();
        showToast('Client added');
    });
}

// ---- Tasks ----

function renderTasks() {
    const root = qs('#page-tasks');
    const clientOptions = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const open = state.tasks.filter(t => t.status !== 'done').length;
    const overdue = state.tasks.filter(t => t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'done').length;

    root.innerHTML = `
        <div class="page-header">
            <div><h1 class="serif">Tasks</h1><p>${open} active - ${overdue} overdue</p></div>
        </div>
        <div class="list" id="tasks-list"></div>
        <div class="inline-form">
            <input type="text" id="new-task-title" placeholder="New task">
            <select id="new-task-client"><option value="">Unassigned</option>${clientOptions}</select>
            <input type="text" id="new-task-lead" placeholder="Creative lead">
            <select id="new-task-priority"><option value="normal">Normal</option><option value="high">High</option></select>
            <input type="date" id="new-task-due">
            <button class="btn btn-primary" id="add-task-btn" type="button">+ New task</button>
        </div>
    `;

    function paint() {
        const list = qs('#tasks-list');
        list.innerHTML = state.tasks.length ? state.tasks.map(t => {
            const overdueFlag = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'done';
            return `
            <div class="list-row ${t.status === 'done' ? 'is-done' : ''}" data-id="${t.id}">
                <div class="list-row-main">
                    <input type="checkbox" data-action="toggle" ${t.status === 'done' ? 'checked' : ''}>
                    <div>
                        <div class="list-row-title">${escapeHtml(t.title)} ${t.priority === 'high' ? '<span class="tag is-priority">High</span>' : ''} ${overdueFlag ? '<span class="tag is-accent">Overdue</span>' : ''}</div>
                        <div class="list-row-meta">${escapeHtml(t.client_name || 'Unassigned')} - ${escapeHtml(t.creative_lead || 'Unassigned lead')} - ${escapeHtml(t.content_type || '')} ${t.due_date ? '- due ' + escapeHtml(t.due_date) : ''}</div>
                    </div>
                </div>
                <div class="list-row-actions"><button class="btn btn-sm btn-danger" data-action="delete">Delete</button></div>
            </div>
        `;
        }).join('') : '<div class="empty-state">No tasks yet</div>';
    }
    paint();

    qs('#add-task-btn').addEventListener('click', async () => {
        const title = qs('#new-task-title').value.trim();
        if (!title) return showToast('Title is required');
        const task = await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
                title,
                client_id: qs('#new-task-client').value ? Number(qs('#new-task-client').value) : null,
                creative_lead: qs('#new-task-lead').value.trim() || null,
                priority: qs('#new-task-priority').value,
                due_date: qs('#new-task-due').value || null,
            }),
        });
        task.client_name = clientById(task.client_id)?.name || null;
        state.tasks.push(task);
        qs('#new-task-title').value = '';
        qs('#new-task-lead').value = '';
        qs('#new-task-due').value = '';
        paint();
        showToast('Task added');
    });

    qs('#tasks-list').addEventListener('click', async e => {
        const row = e.target.closest('.list-row');
        if (!row) return;
        const id = Number(row.dataset.id);
        const task = state.tasks.find(t => t.id === id);
        if (e.target.matches('[data-action="toggle"]')) {
            const updated = await api(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: e.target.checked ? 'done' : 'planned' }) });
            task.status = updated.status;
            paint();
        }
        if (e.target.closest('button[data-action="delete"]')) {
            await api(`/api/tasks/${id}`, { method: 'DELETE' });
            state.tasks = state.tasks.filter(t => t.id !== id);
            paint();
            showToast('Task removed');
        }
    });
}

// ---- Deliverables ----

const DELIVERABLE_STATUSES = ['pending_approval', 'approved', 'pending_revision', 'pending_delivery', 'posted'];
const STATUS_LABEL = {
    pending_approval: 'Pending approval', approved: 'Approved', pending_revision: 'Pending revision',
    pending_delivery: 'Pending delivery', posted: 'Posted',
};

function renderDeliverables() {
    const root = qs('#page-deliverables');
    root.innerHTML = `
        <div class="page-header">
            <div><h1 class="serif">Deliverables</h1><p>${state.deliverables.length} across ${state.clients.length} clients</p></div>
            <button class="btn" id="export-deliverables" type="button">Export PDF</button>
        </div>
        <div class="tabs" id="deliverable-filter-tabs">
            <button data-filter="all" class="${state.deliverableFilter === 'all' ? 'active' : ''}">ALL</button>
            ${DELIVERABLE_STATUSES.map(s => `<button data-filter="${s}" class="${state.deliverableFilter === s ? 'active' : ''}">${STATUS_LABEL[s].toUpperCase()}</button>`).join('')}
        </div>
        <div id="deliverables-by-client" style="margin-top:16px"></div>
    `;

    qsa('[data-filter]', qs('#deliverable-filter-tabs')).forEach(btn => {
        btn.addEventListener('click', () => { state.deliverableFilter = btn.dataset.filter; renderDeliverables(); });
    });

    const filtered = state.deliverables.filter(d => state.deliverableFilter === 'all' || d.status === state.deliverableFilter);
    const byClient = {};
    filtered.forEach(d => {
        const key = d.client_name || 'Unassigned';
        byClient[key] = byClient[key] || [];
        byClient[key].push(d);
    });

    const container = qs('#deliverables-by-client');
    container.innerHTML = Object.keys(byClient).length ? Object.entries(byClient).map(([clientName, items]) => `
        <div class="client-section">
            <div class="client-section-head">
                <h3>${escapeHtml(clientName)} <span style="color:var(--ink-soft);font-weight:400">(${items.length})</span></h3>
                <button class="btn btn-sm" data-action="add-deliverable" data-client="${escapeHtml(clientName)}" type="button">+ Add deliverable</button>
            </div>
            <div class="list">
                ${items.map(d => `
                    <div class="list-row" data-id="${d.id}">
                        <div class="list-row-main">
                            <input type="checkbox" data-action="toggle" ${d.status === 'posted' ? 'checked' : ''}>
                            <div class="list-row-title">${escapeHtml(d.title)}</div>
                            <span class="tag">${escapeHtml(d.type)}</span>
                            <span class="tag is-accent">${STATUS_LABEL[d.status] || d.status}</span>
                        </div>
                        <div class="list-row-actions"><button class="btn btn-sm btn-danger" data-action="delete">Delete</button></div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('') : '<div class="empty-state">No deliverables in this filter</div>';

    container.addEventListener('click', async e => {
        const addBtn = e.target.closest('[data-action="add-deliverable"]');
        if (addBtn) return openAddDeliverableModal(addBtn.dataset.client);

        const row = e.target.closest('.list-row');
        if (!row) return;
        const id = Number(row.dataset.id);
        const deliverable = state.deliverables.find(d => d.id === id);
        if (e.target.matches('[data-action="toggle"]')) {
            const updated = await api(`/api/deliverables/${id}`, { method: 'PUT', body: JSON.stringify({ status: e.target.checked ? 'posted' : 'pending_approval' }) });
            Object.assign(deliverable, updated);
            renderDeliverables();
        }
        if (e.target.closest('button[data-action="delete"]')) {
            await api(`/api/deliverables/${id}`, { method: 'DELETE' });
            state.deliverables = state.deliverables.filter(d => d.id !== id);
            renderDeliverables();
            showToast('Deliverable removed');
        }
    });

    qs('#export-deliverables').addEventListener('click', () => window.print());
}

function openAddDeliverableModal(clientName) {
    const client = state.clients.find(c => c.name === clientName);
    showModal(`
        <h2 class="serif">Add deliverable</h2>
        <form id="add-deliverable-form">
            <div class="form-group"><label>Title</label><input type="text" name="title" required></div>
            <div class="form-group"><label>Type</label><input type="text" name="type" value="Reel"></div>
            <div class="modal-footer">
                <button type="button" class="btn" data-modal-close>Cancel</button>
                <button type="submit" class="btn btn-primary">Add</button>
            </div>
        </form>
    `);
    qs('#add-deliverable-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.currentTarget;
        const d = await api('/api/deliverables', {
            method: 'POST',
            body: JSON.stringify({ title: f.title.value.trim(), type: f.type.value.trim() || 'Reel', client_id: client ? client.id : null }),
        });
        d.client_name = client ? client.name : null;
        state.deliverables.push(d);
        closeModal();
        renderDeliverables();
        showToast('Deliverable added');
    });
}

// ---- Library (stub) ----

function renderLibrary() {
    const root = qs('#page-library');
    const posted = state.deliverables.filter(d => d.status === 'posted');
    root.innerHTML = `
        <div class="page-header"><div><h1 class="serif">Library</h1><p>Completed deliverables across all clients</p></div></div>
        <div class="grid grid-3">
            ${posted.length ? posted.map(d => `
                <div class="card">
                    <div class="client-meta">${escapeHtml(d.client_name || 'Unassigned')}</div>
                    <h3 style="font-size:15px;margin-top:4px">${escapeHtml(d.title)}</h3>
                    <span class="tag">${escapeHtml(d.type)}</span>
                </div>
            `).join('') : '<div class="empty-state">Nothing posted yet</div>'}
        </div>
    `;
}

// ---- Studio (UI placeholder) ----

function renderStudio() {
    const root = qs('#page-studio');
    root.innerHTML = `
        <div class="page-header"><div><h1 class="serif">Studio</h1><p>From transcript to angles</p></div></div>
        <div class="studio-grid">
            <div class="studio-card">
                <h3>Angles</h3>
                <p>Paste a brief or transcript to generate 6-8 content angles.</p>
                <textarea placeholder="Paste brief or transcript..."></textarea>
                <button class="btn btn-primary" style="margin-top:10px" type="button" disabled>Generate angles</button>
            </div>
            <div class="studio-card">
                <h3>Library</h3>
                <p>Browse completed deliverables for reference, pitch decks, and re-cuts.</p>
                <button class="btn" style="margin-top:10px" type="button" data-action="open-library">Open library</button>
            </div>
            <div class="studio-card">
                <h3>Scripts / UGC</h3>
                <p>Talking-head scripts, hook variations, and caption sets.</p>
                <textarea placeholder="Describe the product or offer..."></textarea>
                <button class="btn btn-primary" style="margin-top:10px" type="button" disabled>Generate scripts</button>
            </div>
        </div>
        <p style="margin-top:16px;font-size:12px">AI generation is not wired up yet - these are placeholders.</p>
    `;
    qs('[data-action="open-library"]')?.addEventListener('click', () => goToTab('library'));
}

// ---- Accounting (Sales) ----

async function renderAccounting() {
    const root = qs('#page-accounting');
    const [summary, expenses] = await Promise.all([api('/api/accounting/summary'), api('/api/expenses')]);
    root.innerHTML = `
        <div class="page-header"><div><h1 class="serif">Accounting</h1><p>Revenue, expenses, and gross profit</p></div></div>
        <div class="grid grid-4">
            <div class="card stat-card"><span>Gross Revenue</span><strong>${money(summary.grossRevenue)}</strong></div>
            <div class="card stat-card"><span>Contracts</span><strong>${money(summary.contractRevenue)}</strong></div>
            <div class="card stat-card"><span>Retainers / mo</span><strong>${money(summary.retainerRevenue)}</strong></div>
            <div class="card stat-card"><span>Gross Profit</span><strong style="color:${summary.grossProfit >= 0 ? 'var(--good)' : 'var(--accent)'}">${money(summary.grossProfit)}</strong></div>
        </div>

        <div class="card" style="margin-top:18px">
            <h3>Clients - contract & retainer</h3>
            <div class="list">
                ${state.clients.map(c => `
                    <div class="list-row">
                        <div class="list-row-main">
                            <div>
                                <div class="list-row-title">${escapeHtml(c.name)}</div>
                                <div class="list-row-meta">${escapeHtml(c.contract_status)} - contract ${money(c.contract_value)} - retainer ${money(c.retainer_amount)}/mo</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="card" style="margin-top:18px">
            <div class="toolbar"><h3 style="margin:0">Expenses</h3><span>Total ${money(summary.totalExpenses)}</span></div>
            <div class="list" id="expenses-list">
                ${expenses.length ? expenses.map(e => `
                    <div class="list-row" data-id="${e.id}">
                        <div class="list-row-main">
                            <div>
                                <div class="list-row-title">${escapeHtml(e.description)} - ${money(e.amount)}</div>
                                <div class="list-row-meta">${escapeHtml(e.category)} - ${escapeHtml(e.client_name || 'Agency')} - ${escapeHtml(e.expense_date)}</div>
                            </div>
                        </div>
                        <div class="list-row-actions"><button class="btn btn-sm btn-danger" data-action="delete-expense">Delete</button></div>
                    </div>
                `).join('') : '<div class="empty-state">No expenses logged</div>'}
            </div>
            <div class="inline-form">
                <input type="text" id="exp-desc" placeholder="Description">
                <input type="number" id="exp-amount" placeholder="Amount">
                <input type="text" id="exp-category" placeholder="Category">
                <input type="date" id="exp-date">
                <button class="btn btn-primary" id="add-expense-btn" type="button">+ Add expense</button>
            </div>
        </div>
    `;

    qs('#add-expense-btn').addEventListener('click', async () => {
        const description = qs('#exp-desc').value.trim();
        if (!description) return showToast('Description is required');
        await api('/api/expenses', {
            method: 'POST',
            body: JSON.stringify({
                description, amount: Number(qs('#exp-amount').value) || 0,
                category: qs('#exp-category').value.trim() || 'General',
                expense_date: qs('#exp-date').value || null,
            }),
        });
        renderAccounting();
        showToast('Expense added');
    });

    qs('#expenses-list').addEventListener('click', async e => {
        const row = e.target.closest('.list-row');
        if (!row || !e.target.closest('[data-action="delete-expense"]')) return;
        await api(`/api/expenses/${row.dataset.id}`, { method: 'DELETE' });
        renderAccounting();
        showToast('Expense removed');
    });
}

// ---- Calendar ----

function renderCalendar() {
    const root = qs('#page-calendar');
    root.innerHTML = `
        <div class="toolbar">
            <div class="page-header" style="margin-bottom:0"><div><h1 class="serif">Calendar</h1><p>Shoots, production, and ads by date</p></div></div>
            <div>
                <button class="btn btn-sm" id="cal-prev" type="button">&lt;</button>
                <strong id="cal-label" style="margin:0 8px;font-family:'Lora',serif"></strong>
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

        const byDay = {};
        state.events.forEach(ev => {
            const d = new Date(ev.event_date);
            if (d.getFullYear() === year && d.getMonth() === monthIndex) {
                const day = d.getDate();
                byDay[day] = byDay[day] || [];
                byDay[day].push(ev);
            }
        });

        let cells = '';
        for (let i = 0; i < firstDay; i++) cells += '<div class="calendar-cell is-empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
            const events = byDay[day] || [];
            cells += `
                <div class="calendar-cell">
                    <div class="day-num">${day}</div>
                    ${events.map(ev => `<div class="calendar-event type-${ev.type}" title="${escapeHtml(ev.assignee || '')}">${escapeHtml(ev.client_name || ev.title)}</div>`).join('')}
                </div>
            `;
        }
        qs('#cal-grid').innerHTML = cells;
    }

    qs('#cal-prev').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); paint(); });
    qs('#cal-next').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); paint(); });

    paint();
}

// ---- Admin ----

async function renderAdmin() {
    const root = qs('#page-admin');
    const [users, tabInfo] = await Promise.all([api('/api/admin/users'), api('/api/admin/tabs')]);

    root.innerHTML = `
        <div class="page-header"><div><h1 class="serif">Admin</h1><p>Manage team members and tab permissions</p></div></div>
        <table class="admin-table">
            <thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Tabs</th><th></th></tr></thead>
            <tbody id="admin-users-body"></tbody>
        </table>
        <div class="inline-form">
            <input type="text" id="new-user-name" placeholder="Name">
            <input type="text" id="new-user-title" placeholder="Title">
            <select id="new-user-role"><option value="sales">Sales</option><option value="delivery">Delivery</option><option value="admin">Admin</option></select>
            <button class="btn btn-primary" id="add-user-btn" type="button">+ Add user</button>
        </div>
    `;

    function paintRows() {
        qs('#admin-users-body').innerHTML = users.map(u => `
            <tr data-id="${u.id}">
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.title || '')}</td>
                <td>
                    <select data-action="role">
                        ${['admin', 'sales', 'delivery'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <div class="tab-chip-list">
                        ${tabInfo.allTabs.map(tab => `<span class="tab-chip ${u.tabs.includes(tab) ? 'is-on' : ''}" data-tab="${tab}">${TAB_LABELS[tab]}</span>`).join('')}
                    </div>
                </td>
                <td><button class="btn btn-sm btn-danger" data-action="delete-user">Remove</button></td>
            </tr>
        `).join('');
    }
    paintRows();

    qs('#admin-users-body').addEventListener('click', async e => {
        const row = e.target.closest('tr');
        if (!row) return;
        const id = Number(row.dataset.id);
        const user = users.find(u => u.id === id);

        if (e.target.matches('[data-tab]')) {
            const tab = e.target.dataset.tab;
            const base = new Set(roleTemplate(user.role));
            const tabs = new Set(user.tabs);
            tabs.has(tab) ? tabs.delete(tab) : tabs.add(tab);
            const add = Array.from(tabs).filter(t => !base.has(t));
            const remove = Array.from(base).filter(t => !tabs.has(t));
            const updated = await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ tabOverrides: { add, remove } }) });
            user.tabs = updated.tabs;
            paintRows();
        }

        if (e.target.closest('[data-action="delete-user"]')) {
            await api(`/api/admin/users/${id}`, { method: 'DELETE' });
            const idx = users.findIndex(u => u.id === id);
            users.splice(idx, 1);
            paintRows();
            showToast('User removed');
        }
    });

    qs('#admin-users-body').addEventListener('change', async e => {
        if (!e.target.matches('[data-action="role"]')) return;
        const row = e.target.closest('tr');
        const id = Number(row.dataset.id);
        const user = users.find(u => u.id === id);
        const updated = await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ role: e.target.value, tabOverrides: { add: [], remove: [] } }) });
        Object.assign(user, updated);
        paintRows();
    });

    qs('#add-user-btn').addEventListener('click', async () => {
        const name = qs('#new-user-name').value.trim();
        if (!name) return showToast('Name is required');
        const user = await api('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ name, title: qs('#new-user-title').value.trim(), role: qs('#new-user-role').value }),
        });
        users.push(user);
        qs('#new-user-name').value = '';
        qs('#new-user-title').value = '';
        paintRows();
        showToast('User added - default PIN 0000');
    });
}

function roleTemplate(role) {
    const templates = {
        admin: ['dashboard', 'clients', 'calendar', 'tasks', 'deliverables', 'library', 'studio', 'accounting', 'admin'],
        sales: ['dashboard', 'clients', 'calendar', 'tasks', 'accounting'],
        delivery: ['dashboard', 'clients', 'calendar', 'tasks', 'deliverables', 'library', 'studio'],
    };
    return templates[role] || [];
}

document.addEventListener('DOMContentLoaded', () => {
    initCheckin();
});

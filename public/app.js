// --- STATE ---
let currentUser = null;
let startMonth = '2026-06';
let endMonth   = '2026-11';
let availabilities  = {};   // Saved states from DB
let pendingUpdates  = {};   // Unsaved edits during edit mode
let editMode        = false;
let activeEditCell  = null;

// --- CONSTANTS ---
const MONTH_NAMES = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];
const WEEK_DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

// --- BOOT ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initModals();
    await checkAdminInit();
    await checkSession();
    await loadCalendarData();
});

// ============================================================
// THEME
// ============================================================
function initTheme() {
    const btn = document.getElementById('theme-toggle');
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        setTheme(next);
    });
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.querySelector('#theme-toggle i');
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// ============================================================
// MODALS
// ============================================================
function initModals() {
    // Click on overlay backdrop OR on .modal-close button closes modal
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); document.body.style.overflow = ''; }
}

// ============================================================
// AUTH & SESSION
// ============================================================
async function checkAdminInit() {
    try {
        const res  = await fetch('/api/auth/check-init');
        const data = await res.json();
        if (!data.initialized) openModal('modal-setup');
    } catch (e) { console.error('Init check failed', e); }
}

async function checkSession() {
    try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
            const data = await res.json();
            if (data.loggedIn) { setLoggedInUser(data.username); return; }
        }
    } catch (_) {}
    setLoggedOut();
}

function setLoggedInUser(username) {
    currentUser = username;
    document.getElementById('btn-login-open').classList.add('hidden');
    document.getElementById('user-logged-in').classList.remove('hidden');
    document.getElementById('username-display').textContent = username;
    document.getElementById('admin-actions-bar').classList.remove('hidden');

    const btn = document.getElementById('btn-modify-availabilities');
    btn.innerHTML = '<i class="fa-solid fa-edit"></i> ENTRER EN MODE ÉDITION';
}

function setLoggedOut() {
    currentUser = null;
    document.getElementById('btn-login-open').classList.remove('hidden');
    document.getElementById('user-logged-in').classList.add('hidden');
    document.getElementById('admin-actions-bar').classList.add('hidden');
    exitEditMode(false);

    const btn = document.getElementById('btn-modify-availabilities');
    btn.innerHTML = '<i class="fa-solid fa-square-check"></i> MODIFIER LES DISPONIBILITÉS';
}

// ============================================================
// CALENDAR DATA + RENDERING
// ============================================================
async function loadCalendarData() {
    try {
        // Settings (month range)
        const settingsRes = await fetch('/api/settings');
        if (settingsRes.ok) {
            const s = await settingsRes.json();
            startMonth = s.start_month;
            endMonth   = s.end_month;
        }
        updateRangeText();

        // Availabilities
        const availRes = await fetch('/api/availabilities');
        if (availRes.ok) {
            const d = await availRes.json();
            availabilities = d.availabilities || {};
        }

        renderCalendars();
    } catch (e) {
        console.error('Calendar load error', e);
        document.getElementById('calendars-grid').innerHTML =
            '<div class="alert alert-danger" style="grid-column:1/-1;text-align:center">' +
            '<i class="fa-solid fa-triangle-exclamation"></i> Impossible de charger les données.</div>';
    }
}

function updateRangeText() {
    const [sY, sM] = startMonth.split('-');
    const [eY, eM] = endMonth.split('-');
    document.getElementById('calendar-range-text').textContent =
        `${MONTH_NAMES[+sM - 1]} ${sY} — ${MONTH_NAMES[+eM - 1]} ${eY}`;
}

function renderCalendars() {
    const grid   = document.getElementById('calendars-grid');
    grid.innerHTML = '';
    const months = getMonthRange(startMonth, endMonth);

    if (!months.length) {
        grid.innerHTML = '<div class="alert alert-danger" style="grid-column:1/-1;text-align:center">Période invalide.</div>';
        return;
    }

    months.forEach(m => grid.appendChild(createMonthPanel(m)));
}

function getMonthRange(start, end) {
    const result = [];
    let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    while (y * 12 + m <= ey * 12 + em) {
        result.push(`${y}-${String(m).padStart(2, '0')}`);
        if (++m > 12) { m = 1; y++; }
    }
    return result;
}

function createMonthPanel(monthStr) {
    const [year, monthIdx] = monthStr.split('-').map(Number);

    const panel = document.createElement('div');
    panel.className = 'month-panel';

    // Title
    const title = document.createElement('h3');
    title.className = 'month-name';
    title.textContent = `${MONTH_NAMES[monthIdx - 1]} ${year}`;
    panel.appendChild(title);

    // Days grid
    const grid = document.createElement('div');
    grid.className = 'month-days-grid';

    // Day headers
    WEEK_DAYS.forEach(d => {
        const h = document.createElement('div');
        h.className = 'day-header';
        h.textContent = d;
        grid.appendChild(h);
    });

    // Offset empty cells (Monday-first)
    const firstDow = new Date(year, monthIdx - 1, 1).getDay();
    const offset   = (firstDow + 6) % 7;
    for (let i = 0; i < offset; i++) {
        const empty = document.createElement('div');
        empty.className = 'day-cell empty';
        grid.appendChild(empty);
    }

    // Day cells
    const totalDays = new Date(year, monthIdx, 0).getDate();
    for (let d = 1; d <= totalDays; d++) {
        const dateStr = `${year}-${String(monthIdx).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.setAttribute('data-date', dateStr);
        cell.textContent = d;

        const status = pendingUpdates[dateStr] ?? availabilities[dateStr] ?? 'unavailable';
        cell.classList.add(`status-${status}`);

        cell.addEventListener('click', e => {
            if (editMode) handleCellClick(cell, dateStr, e);
        });

        grid.appendChild(cell);
    }

    panel.appendChild(grid);
    return panel;
}

// ============================================================
// EDIT MODE
// ============================================================
function handleCellClick(cell, dateStr, event) {
    event.stopPropagation();

    if (activeEditCell) activeEditCell.classList.remove('active-edit');
    activeEditCell = cell;
    cell.classList.add('active-edit');

    // Label
    const [y, mo, d] = dateStr.split('-');
    document.getElementById('popover-date-label').textContent =
        `${+d} ${MONTH_NAMES[+mo - 1]} ${y}`;

    // Position popover
    const popover = document.getElementById('day-status-popover');
    popover.classList.remove('hidden');

    const rect      = cell.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft= window.pageXOffset || document.documentElement.scrollLeft;

    // Try above, else below
    const spaceAbove = rect.top;
    const popH = 120; // approx height
    let top = rect.top + scrollTop - popH - 8;
    if (spaceAbove < popH + 16) top = rect.bottom + scrollTop + 8;

    let left = rect.left + scrollLeft + rect.width / 2 - 100; // 100 = half of 200px width
    left = Math.max(8, Math.min(left, window.innerWidth - 208));

    popover.style.top  = `${top}px`;
    popover.style.left = `${left}px`;
}

document.querySelectorAll('.status-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!activeEditCell) return;
        const dateStr   = activeEditCell.getAttribute('data-date');
        const newStatus = btn.getAttribute('data-status');

        activeEditCell.className = `day-cell status-${newStatus}${editMode ? ' active-edit' : ''}`;
        pendingUpdates[dateStr]  = newStatus;
        closePopover();
    });
});

document.getElementById('btn-popover-close').addEventListener('click', closePopover);

function closePopover() {
    document.getElementById('day-status-popover').classList.add('hidden');
    if (activeEditCell) { activeEditCell.classList.remove('active-edit'); activeEditCell = null; }
}

document.addEventListener('click', e => {
    const popover = document.getElementById('day-status-popover');
    if (!popover.classList.contains('hidden') &&
        !popover.contains(e.target) &&
        !e.target.classList.contains('day-cell')) {
        closePopover();
    }
});

function enterEditMode() {
    editMode = true;
    pendingUpdates = {};
    document.body.classList.add('edit-mode');

    document.getElementById('btn-edit-mode-toggle').innerHTML =
        '<i class="fa-solid fa-times"></i> Quitter';
    document.getElementById('btn-edit-mode-toggle').className = 'btn btn-sm btn-outline-danger';

    const saveBtn = document.getElementById('btn-modify-availabilities');
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> ENREGISTRER';
    saveBtn.className = 'btn btn-large btn-success';

    // Add cancel button
    if (!document.getElementById('btn-cancel-availabilities')) {
        const cancel = document.createElement('button');
        cancel.id = 'btn-cancel-availabilities';
        cancel.className = 'btn btn-secondary';
        cancel.innerHTML = '<i class="fa-solid fa-ban"></i> Annuler';
        cancel.addEventListener('click', () => exitEditMode(false));
        document.querySelector('.bottom-action-container').insertBefore(cancel, saveBtn);
    }
}

async function exitEditMode(save) {
    if (save && Object.keys(pendingUpdates).length > 0) {
        const updates = Object.entries(pendingUpdates).map(([date, status]) => ({ date, status }));
        try {
            const res = await fetch('/api/availabilities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
            if (res.ok) {
                availabilities = { ...availabilities, ...pendingUpdates };
            } else {
                alert("Erreur lors de l'enregistrement.");
            }
        } catch (_) { alert("Erreur réseau."); }
    }

    editMode = false;
    pendingUpdates = {};
    document.body.classList.remove('edit-mode');
    closePopover();

    const toggleBtn = document.getElementById('btn-edit-mode-toggle');
    if (toggleBtn) {
        toggleBtn.innerHTML = '<i class="fa-solid fa-edit"></i> Activer l\'édition';
        toggleBtn.className = 'btn btn-sm btn-primary';
    }

    const saveBtn = document.getElementById('btn-modify-availabilities');
    saveBtn.innerHTML = currentUser
        ? '<i class="fa-solid fa-edit"></i> ENTRER EN MODE ÉDITION'
        : '<i class="fa-solid fa-square-check"></i> MODIFIER LES DISPONIBILITÉS';
    saveBtn.className = 'btn btn-large btn-success';

    document.getElementById('btn-cancel-availabilities')?.remove();
    renderCalendars();
}

// Main CTA button
document.getElementById('btn-modify-availabilities').addEventListener('click', () => {
    if (!currentUser) { openModal('modal-login'); return; }
    editMode ? exitEditMode(true) : enterEditMode();
});

// Admin toggle button
document.getElementById('btn-edit-mode-toggle').addEventListener('click', () => {
    editMode ? exitEditMode(false) : enterEditMode();
});

// ============================================================
// SETTINGS (month range)
// ============================================================
document.getElementById('btn-config-months').addEventListener('click', () => {
    document.getElementById('settings-start-month').value = startMonth;
    document.getElementById('settings-end-month').value   = endMonth;
    document.getElementById('settings-error').classList.add('hidden');
    document.getElementById('settings-success').classList.add('hidden');
    openModal('modal-settings');
});

document.getElementById('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const startVal = document.getElementById('settings-start-month').value;
    const endVal   = document.getElementById('settings-end-month').value;
    const errDiv   = document.getElementById('settings-error');
    const okDiv    = document.getElementById('settings-success');
    errDiv.classList.add('hidden');
    okDiv.classList.add('hidden');

    if (new Date(startVal + '-01') > new Date(endVal + '-01')) {
        errDiv.textContent = 'Le mois de début doit être avant le mois de fin.';
        errDiv.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_month: startVal, end_month: endVal })
        });
        if (res.ok) {
            startMonth = startVal;
            endMonth   = endVal;
            updateRangeText();
            renderCalendars();
            okDiv.classList.remove('hidden');
            setTimeout(() => closeModal('modal-settings'), 900);
        } else {
            const d = await res.json();
            errDiv.textContent = d.error || 'Erreur.';
            errDiv.classList.remove('hidden');
        }
    } catch (_) {
        errDiv.textContent = 'Erreur réseau.';
        errDiv.classList.remove('hidden');
    }
});

// ============================================================
// LOGIN FORM
// ============================================================
document.getElementById('btn-login-open').addEventListener('click', () => {
    document.getElementById('login-error').classList.add('hidden');
    openModal('modal-login');
});

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errDiv   = document.getElementById('login-error');
    errDiv.classList.add('hidden');

    try {
        const res  = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            closeModal('modal-login');
            setLoggedInUser(data.username);
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        } else {
            errDiv.textContent = data.error || 'Identifiants incorrects.';
            errDiv.classList.remove('hidden');
        }
    } catch (_) {
        errDiv.textContent = 'Erreur réseau.';
        errDiv.classList.remove('hidden');
    }
});

// ============================================================
// LOGOUT
// ============================================================
document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    setLoggedOut();
});

// ============================================================
// SETUP FORM (first admin creation)
// ============================================================
document.getElementById('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('setup-username').value;
    const password = document.getElementById('setup-password').value;
    const errDiv   = document.getElementById('setup-error');
    errDiv.classList.add('hidden');

    try {
        const res  = await fetch('/api/auth/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-setup');
            document.getElementById('login-username').value = username;
            openModal('modal-login');
        } else {
            errDiv.textContent = data.error || 'Erreur.';
            errDiv.classList.remove('hidden');
        }
    } catch (_) {
        errDiv.textContent = 'Erreur réseau.';
        errDiv.classList.remove('hidden');
    }
});

// Script/script.js
// Navegação entre telas, filtros e buscas. Dados e cadastro ficam em app.js / db.js.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pt = (v) => v.trim().toLocaleLowerCase('pt-BR');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ---------- Telas (login → áreas → app) ----------
const stages = { login: $('#stage-login'), launcher: $('#stage-launcher'), app: $('#stage-app') };

function showStage(name) {
    Object.entries(stages).forEach(([key, el]) => { if (el) el.hidden = key !== name; });
    try { localStorage.setItem('pv_stage', name); } catch {}
    window.scrollTo({ top: 0 });
}

// ---------- Login (Supabase Auth) ----------
const loginForm = $('#login-form');
const loginError = $('#login-error');
const loginButton = $('#login-submit');

function loginMessage(text) {
    loginError.textContent = text;
    loginError.hidden = !text;
}

loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#login-user').value.trim();
    const password = $('#login-pass').value;
    if (!email || !password) { loginMessage('Informe o e-mail e a senha para entrar.'); return; }
    loginMessage('');
    loginButton.disabled = true;
    loginButton.textContent = 'Entrando…';
    try {
        const { error } = await signIn(email, password);
        if (error) { loginMessage('Não foi possível entrar: ' + error.message); return; }
        await initApp();
        refreshEvents();
        try { sessionStorage.setItem('pv_tab_login', '1'); } catch {}
        applyUser((await getSession())?.user);
        showStage('launcher');
    } catch (err) {
        loginMessage('Falha de conexão. Verifique a internet e tente novamente.');
        console.error(err);
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = 'Entrar';
    }
});

async function logout() {
    if (!confirm('Deseja sair da conta?')) return;
    try { sessionStorage.removeItem('pv_tab_login'); } catch {}
    try { await signOut(); } catch (err) { console.error(err); }
    $('#login-pass').value = '';
    showStage('login');
}
$('#launcher-logout')?.addEventListener('click', logout);
$('#app-logout')?.addEventListener('click', logout);
$('#open-launcher')?.addEventListener('click', () => showStage('launcher'));
$('#sidebar-toggle')?.addEventListener('click', () => $('#stage-app').classList.toggle('collapsed'));

// ---------- Navegação interna ----------
const labels = { overview: 'Visão geral', equipment: 'Equipamentos', people: 'Profissionais', events: 'Eventos', allocation: 'Alocação de equipamentos', schedule: 'Escala de equipe', return: 'Saída e retorno', map: 'Mapa de ocupação', dataquality: 'Qualidade dos dados' };

function showView(viewId) {
    if (!labels[viewId]) return;
    try { localStorage.setItem('pv_view', viewId); } catch { }
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === viewId));
    $$('.menu-item').forEach((item) => {
        const on = item.dataset.view === viewId;
        item.classList.toggle('active', on);
        if (on) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    $('#crumb').textContent = labels[viewId].toUpperCase();
    $('#page-title').textContent = labels[viewId];
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Delegação: funciona também para botões criados depois pelo app.js.
document.addEventListener('click', (event) => {
    const t = event.target;
    const tile = t.closest('.launcher-tile');
    if (tile) { showStage('app'); showView(tile.dataset.launch); return; }
    const menu = t.closest('.menu-item');
    if (menu) { showView(menu.dataset.view); return; }
    const go = t.closest('[data-go]');
    if (go) { showView(go.dataset.go); return; }
    const modal = t.closest('[data-modal]');
    if (modal) { document.getElementById(modal.dataset.modal)?.showModal(); return; }
    if (t.closest('.close')) { t.closest('dialog').close(); return; }
    if (t.matches('dialog')) t.close(); // clique no fundo fecha o modal
});

// ---------- Filtro de eventos (abas) ----------
const eventSummary = $('#events-summary');
const phaseNames = { all: 'Todos os eventos', proposta: 'Eventos em proposta', contratado: 'Eventos contratados', escalado: 'Eventos escalados', execucao: 'Eventos em execução' };
let eventFilter = 'all';
const eventRows = () => $$('#event-body tr[data-status]');

function refreshEvents(filter = eventFilter) {
    eventFilter = filter;
    const rows = eventRows();
    let visible = 0;
    rows.forEach((row) => {
        const show = filter === 'all' || row.dataset.status === filter;
        row.hidden = !show;
        if (show) visible += 1;
    });
    const empty = $('.empty-events');
    if (empty) empty.hidden = visible !== 0;
    $$('.tab[data-filter]').forEach((tab) => {
        const f = tab.dataset.filter;
        const active = f === filter;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.querySelector('b').textContent = f === 'all' ? rows.length : rows.filter((r) => r.dataset.status === f).length;
    });
    if (!eventSummary) return;
    const conflicts = rows.filter((row) => !row.hidden && row.querySelector('.conflict')).length;
    const note = conflicts ? `${conflicts} exige${conflicts === 1 ? '' : 'm'} atenção antes da confirmação.` : 'Nenhum conflito nesta etapa.';
    eventSummary.innerHTML = `<span class="summary-icon">${visible}</span><p><b>${phaseNames[filter]}</b><small>${plural(visible, 'evento exibido', 'eventos exibidos')} · ${note}</small></p><span class="summary-note">Use as abas para filtrar por fase operacional</span>`;
}

$$('.tab[data-filter]').forEach((tab) => tab.addEventListener('click', () => refreshEvents(tab.dataset.filter)));
refreshEvents('all');

// ---------- Busca (equipamentos e profissionais) ----------
function setupSearch({ input, body, empty, results, one, many }) {
    const field = $(input);
    if (!field) return () => { };
    const apply = () => {
        const term = pt(field.value);
        const rows = $$(`${body} tr:not(${empty})`);
        let visible = 0;
        rows.forEach((row) => {
            const match = pt(row.textContent).includes(term);
            row.hidden = !match;
            if (match) visible += 1;
        });
        const emptyRow = $(empty);
        if (emptyRow) emptyRow.hidden = visible !== 0;
        const out = $(results);
        if (out) out.textContent = plural(visible, one, many);
    };
    field.addEventListener('input', apply);
    return apply;
}
const searches = [
    setupSearch({ input: '#equipment-search', body: '#equipment-body', empty: '.empty-equipment', results: '#equipment-results', one: 'equipamento encontrado', many: 'equipamentos encontrados' }),
    setupSearch({ input: '#people-search', body: '#people-body', empty: '.empty-people', results: '#people-results', one: 'profissional encontrado', many: 'profissionais encontrados' }),
];

// ---------- Qualidade dos dados (abas) ----------
function updateDqTabs(filter) {
    $$('#dataquality-body tr[data-dq]').forEach((row) => { row.hidden = !(filter === 'all' || row.dataset.dq === filter); });
    $$('.tab[data-dq-filter]').forEach((tab) => {
        const active = tab.dataset.dqFilter === filter;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
}
$$('.tab[data-dq-filter]').forEach((tab) => tab.addEventListener('click', () => updateDqTabs(tab.dataset.dqFilter)));

// ---------- Mantém filtros e buscas ao app.js redesenhar as tabelas ----------
const watch = (sel, fn) => { const el = $(sel); if (el) new MutationObserver(fn).observe(el, { childList: true }); };
watch('#event-body', () => refreshEvents());
watch('#equipment-body', () => searches[0]());
watch('#people-body', () => searches[1]());

window.PalcoUI = { showStage, showView, refreshEvents };

(() => {
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ======================= USUÁRIO + SESSÃO =======================
    function formatName(user) {
        const meta = user?.user_metadata || {};
        const raw = meta.full_name || meta.name || meta.nome || (user?.email || '').split('@')[0];
        const clean = String(raw).replace(/[._-]+/g, ' ').trim();
        if (!clean) return 'Usuário';
        return clean.split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    }

    function greeting() {
        const hour = new Date().getHours();
        return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    }

    function applyUser(user) {
        if (!user) return;
        const parts = formatName(user).split(' ');
        const first = parts[0];
        const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : first.slice(0, 2)).toUpperCase();
        document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = first; el.title = user.email || ''; });
        document.querySelectorAll('[data-user-initials]').forEach((el) => { el.textContent = initials; });
        document.querySelectorAll('[data-greeting]').forEach((el) => { el.textContent = `${greeting()}, ${first}.`; });
    }
    window.applyUser = applyUser;

    // Comportamento do login ao abrir/recarregar a página:
    //   'reload' = continua logado só ao recarregar (F5); ao abrir o site de novo, pede o login
    //   'always' = continua logado até clicar em Sair
    //   'never'  = sempre pede o login
    const LOGIN_MODE = 'reload';

    async function restoreSession() {
        stages.login.hidden = true; // evita piscar a tela de login
        try {
            const session = await getSession();
            const sameTab = sessionStorage.getItem('pv_tab_login') === '1';
            const allowed = LOGIN_MODE === 'always' || (LOGIN_MODE === 'reload' && sameTab);
            if (!session || !allowed) { showStage('login'); return; }
            applyUser(session.user);
            await initApp();
            if (localStorage.getItem('pv_stage') === 'app') {
                showStage('app');
                showView(localStorage.getItem('pv_view') || 'overview');
            } else {
                showStage('launcher');
            }
        } catch (err) {
            console.error(err);
            showStage('login');
        }
    }
    restoreSession();

    // ======================= DADOS AO VIVO: notificações + mapa =======================
    const notifPanel = document.querySelector('#notif-panel');
    const NOTIF_KEY = 'pv_notifs_lidas';
    let notifAnchor = null;
    let notifications = [];
    let occupancyData = [];

    // Lê os dados que o app.js carregou (variável global "data") e calcula os conflitos RN-01, RN-03 e RN-07.
    function computeLive() {
        const d = typeof data !== 'undefined' ? data : null;
        if (!d) return;
        const events = new Map(d.eventos.map((e) => [e.id, e]));
        const equipment = new Map(d.equipamentos.map((e) => [e.id, e]));
        const people = new Map(d.profissionais.map((p) => [p.id, p]));
        const span = (e) => ({ start: e.data_montagem || e.data_execucao_inicio, end: e.data_desmontagem || e.data_execucao_fim || e.data_execucao_inicio || e.data_montagem });
        const overlap = (a, b) => a.start <= b.end && b.start <= a.end;
        // RN-02: equipamento que exige folga fica bloqueado também no dia seguinte à desmontagem.
        const addDay = (iso) => { const [y, m, dd] = iso.split('-').map(Number); const t = new Date(y, m - 1, dd + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
        const withRest = (s, eq) => (eq.exige_folga && s.end ? { start: s.start, end: addDay(s.end) } : s);
        const bars = [];
        const notes = new Map();

        d.alocacoes.forEach((a) => {
            const ev = events.get(a.evento_id);
            const eq = equipment.get(a.equipamento_id);
            if (!ev || !eq) return;
            const s = span(ev);
            if (!s.start) return;
            const used = d.alocacoes
                .filter((o) => o.equipamento_id === a.equipamento_id && events.get(o.evento_id) && overlap(withRest(s, eq), withRest(span(events.get(o.evento_id)), eq)))
                .reduce((sum, o) => sum + o.quantidade, 0);
            const conflict = used > eq.quantidade;
            bars.push({ resource: eq.nome, type: 'Equipamento', start: s.start, end: s.end, status: conflict ? 'conflict' : 'busy', label: ev.nome });
            if (conflict) notes.set(`rn01-${eq.id}`, { id: `rn01-${eq.id}`, level: 'critical', title: `${eq.nome}: pedido acima do estoque`, text: `Eventos no mesmo período pedem ${used} de ${eq.quantidade} unidades (RN-01).`, go: 'allocation' });
        });

        d.escalas.forEach((sc) => {
            const ev = events.get(sc.evento_id);
            const p = people.get(sc.profissional_id);
            if (!ev || !p) return;
            const s = span(ev);
            if (!s.start) return;
            const clash = d.escalas.some((o) => o.id !== sc.id && o.profissional_id === sc.profissional_id && events.get(o.evento_id) && overlap(s, span(events.get(o.evento_id))));
            bars.push({ resource: p.nome, type: 'Equipe', start: s.start, end: s.end, status: clash ? 'conflict' : 'busy', label: ev.nome });
            if (clash) notes.set(`rn03-${p.id}`, { id: `rn03-${p.id}`, level: 'critical', title: `${p.nome} escalado em dois eventos`, text: 'Os eventos se sobrepõem no período (RN-03).', go: 'schedule' });
        });

        d.conferencias.forEach((c) => {
            if (!(c.quantidade_avariada > 0)) return;
            const a = d.alocacoes.find((x) => x.id === c.alocacao_id);
            const eq = a && equipment.get(a.equipamento_id);
            const ev = a && events.get(a.evento_id);
            notes.set(`rn07-${c.id}`, { id: `rn07-${c.id}`, level: 'warning', title: `${c.quantidade_avariada} ${eq ? eq.nome : 'equipamento'} em manutenção`, text: `Avaria registrada na conferência de ${ev ? ev.nome : 'um evento'} (RN-07).`, go: 'return' });
        });

        occupancyData = bars;
        notifications = [...notes.values()].sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1));
    }

    // ---------- Notificações ----------
    function readIds() { try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')); } catch { return new Set(); } }
    function saveReadIds(set) { try { localStorage.setItem(NOTIF_KEY, JSON.stringify([...set])); } catch {} }

    function updateBadges() {
        const read = readIds();
        const unread = notifications.filter((n) => !read.has(n.id)).length;
        document.querySelectorAll('.notification i').forEach((badge) => { badge.textContent = unread; badge.hidden = unread === 0; });
    }

    function renderNotifications() {
        if (!notifPanel) return;
        const read = readIds();
        const items = notifications.map((n) => `<button class="notif-item ${n.level} ${read.has(n.id) ? 'read' : ''}" data-notif="${escapeHtml(n.id)}"><span class="dot"></span><span><b>${escapeHtml(n.title)}</b><small>${escapeHtml(n.text)}</small></span></button>`).join('');
        notifPanel.innerHTML = `<div class="notif-head"><h3>Notificações</h3><button class="text-button" id="notif-read-all">Marcar todas como lidas</button></div>${items || '<p class="notif-empty">Nenhuma notificação.</p>'}`;
        updateBadges();
    }

    function openNotifications(bell) {
        if (!notifPanel) return;
        renderNotifications();
        notifPanel.hidden = false;
        const rect = bell.getBoundingClientRect();
        notifPanel.style.top = `${rect.bottom + 10}px`;
        notifPanel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
        notifAnchor = bell;
    }

    function closeNotifications() { if (notifPanel) notifPanel.hidden = true; notifAnchor = null; }

    document.addEventListener('click', (event) => {
        const bell = event.target.closest('.notification');
        if (bell) { notifAnchor === bell ? closeNotifications() : openNotifications(bell); return; }

        const item = event.target.closest('[data-notif]');
        if (item) {
            const read = readIds();
            read.add(item.dataset.notif);
            saveReadIds(read);
            const target = notifications.find((n) => n.id === item.dataset.notif);
            closeNotifications();
            updateBadges();
            if (target?.go) { showStage('app'); showView(target.go); }
            return;
        }

        if (event.target.closest('#notif-read-all')) {
            const read = readIds();
            notifications.forEach((n) => read.add(n.id));
            saveReadIds(read);
            renderNotifications();
            return;
        }

        if (!event.target.closest('#notif-panel')) closeNotifications();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNotifications(); });

    // ---------- Mapa de ocupação (Gantt mensal) ----------
    const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const toDate = (iso) => new Date(`${iso}T00:00:00`);
    const now = new Date();
    let mapDate = new Date(now.getFullYear(), now.getMonth(), 1);

    function renderOccupancy() {
        const box = document.querySelector('#occupancy');
        if (!box) return;
        const y = mapDate.getFullYear();
        const m = mapDate.getMonth();
        const days = new Date(y, m + 1, 0).getDate();
        const first = new Date(y, m, 1);
        const last = new Date(y, m, days);
        const monthLabel = document.querySelector('#map-month');
        if (monthLabel) monthLabel.textContent = `${MONTHS[m]} ${y}`;

        let html = `<div class="days head" style="--n:${days}"><b>Recurso</b>`;
        for (let d = 1; d <= days; d++) html += `<b>${d}<small>${WEEKDAYS[new Date(y, m, d).getDay()]}</small></b>`;
        html += '</div>';

        const groups = new Map();
        occupancyData.forEach((item) => {
            const start = toDate(item.start);
            const end = toDate(item.end || item.start);
            if (end < first || start > last) return; // fora do mês exibido
            if (!groups.has(item.resource)) groups.set(item.resource, { type: item.type, items: [] });
            groups.get(item.resource).items.push(item);
        });

        groups.forEach((group, name) => {
            // Barras que se sobrepõem vão para linhas separadas (faixas)
            const lanes = [];
            group.items.slice().sort((a, b) => (a.start < b.start ? -1 : 1)).forEach((item) => {
                const lane = lanes.find((l) => l[l.length - 1].end < item.start);
                if (lane) lane.push(item); else lanes.push([item]);
            });
            lanes.forEach((lane, index) => {
                html += `<div class="days" style="--n:${days}">`;
                html += index === 0 ? `<strong>${escapeHtml(name)}<small>${escapeHtml(group.type || '')}</small></strong>` : '<span style="grid-column:1"></span>';
                for (let d = 1; d <= days; d++) html += `<span class="cell" style="grid-column:${d + 1}"></span>`;
                lane.forEach((item) => {
                    const start = toDate(item.start);
                    const end = toDate(item.end || item.start);
                    const from = (start < first ? first : start).getDate();
                    const to = (end > last ? last : end).getDate();
                    html += `<i class="${item.status === 'conflict' ? 'conflict' : 'busy'}" style="grid-column:${from + 1} / ${to + 2}" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</i>`;
                });
                html += '</div>';
            });
        });
        if (!groups.size) html += '<p class="map-empty">Nenhuma alocação neste mês.</p>';
        box.innerHTML = html;
    }

    function changeMonth(step) {
        mapDate = new Date(mapDate.getFullYear(), mapDate.getMonth() + step, 1);
        renderOccupancy();
    }
    document.querySelector('#map-prev')?.addEventListener('click', () => changeMonth(-1));
    document.querySelector('#map-next')?.addEventListener('click', () => changeMonth(1));

    // O app.js chama PalcoLive.refresh() sempre que carrega ou redesenha os dados.
    window.PalcoLive = { refresh() { computeLive(); renderOccupancy(); updateBadges(); } };
    window.PalcoLive.refresh();
})();
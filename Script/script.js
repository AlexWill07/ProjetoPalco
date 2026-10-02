// Script/script.js
// Navegação entre telas e filtros. A lógica de dados e cadastro está em app.js.

const stages = { login: document.querySelector('#stage-login'), launcher: document.querySelector('#stage-launcher'), app: document.querySelector('#stage-app') };

function showStage(name) {
    Object.entries(stages).forEach(([key, el]) => { el.hidden = key !== name; });
    window.scrollTo({ top: 0 });
}

// Login real (Supabase Auth). Ao entrar, carrega os dados e renderiza as telas.
document.querySelector('#login-submit').addEventListener('click', async () => {
    const email = document.querySelector('#login-user').value.trim();
    const password = document.querySelector('#login-pass').value;
    if (!email || !password) { alert('Informe usuário e senha.'); return; }
    const { error } = await signIn(email, password);
    if (error) { alert('Não foi possível entrar: ' + error.message); return; }
    await initApp();
    showStage('launcher');
});

document.querySelectorAll('.launcher-tile').forEach((tile) => tile.addEventListener('click', () => {
    showStage('app');
    showView(tile.dataset.launch);
}));

document.querySelector('#open-launcher').addEventListener('click', () => showStage('launcher'));
document.querySelector('#launcher-logout').addEventListener('click', async () => { await signOut(); showStage('login'); });

const labels = { overview: 'Visão geral', equipment: 'Equipamentos', people: 'Profissionais', events: 'Eventos', allocation: 'Alocação de equipamentos', schedule: 'Escala de equipe', return: 'Saída e retorno', map: 'Mapa de ocupação', dataquality: 'Qualidade dos dados' };
const menuItems = document.querySelectorAll('.menu-item');
const views = document.querySelectorAll('.view');
const crumb = document.querySelector('#crumb');
const title = document.querySelector('#page-title');

function showView(viewId) {
    views.forEach((view) => view.classList.toggle('active', view.id === viewId));
    menuItems.forEach((item) => item.classList.toggle('active', item.dataset.view === viewId));
    crumb.textContent = labels[viewId].toUpperCase();
    title.textContent = labels[viewId];
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

menuItems.forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.go)));

document.querySelectorAll('[data-modal]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.modal}`).showModal()));
document.querySelectorAll('.close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

// ---------- Filtro de eventos (abas) ----------
const eventTabs = document.querySelectorAll('.tab[data-filter]');
const eventRows = () => [...document.querySelectorAll('#event-body tr[data-status]')];
const eventSummary = document.querySelector('#events-summary');
const phaseNames = { all: 'Todos os eventos', proposta: 'Eventos em proposta', contratado: 'Eventos contratados', escalado: 'Eventos escalados', execucao: 'Eventos em execução' };

function updateEventCounts() {
    eventTabs.forEach((tab) => {
        const filter = tab.dataset.filter;
        const count = filter === 'all' ? eventRows().length : eventRows().filter((row) => row.dataset.status === filter).length;
        tab.querySelector('b').textContent = count;
    });
}

function updateEventTabs(filter) {
    const rows = eventRows();
    let visible = 0;
    rows.forEach((row) => {
        const show = filter === 'all' || row.dataset.status === filter;
        row.hidden = !show;
        if (show) visible += 1;
    });
    const emptyEvents = document.querySelector('.empty-events');
    if (emptyEvents) emptyEvents.hidden = visible !== 0;
    eventTabs.forEach((tab) => {
        const active = tab.dataset.filter === filter;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    const conflicts = rows.filter((row) => !row.hidden && row.querySelector('.conflict')).length;
    eventSummary.innerHTML = `<span class="summary-icon">${visible}</span><p><b>${phaseNames[filter]}</b><small>${visible} evento${visible === 1 ? '' : 's'} exibido${visible === 1 ? '' : 's'}${conflicts ? ` · ${conflicts} exige atenção antes da confirmação.` : ' · Nenhum conflito nesta etapa.'}</small></p><span class="summary-note">Use as abas para filtrar por fase operacional</span>`;
    updateEventCounts();
}

eventTabs.forEach((tab) => tab.addEventListener('click', () => updateEventTabs(tab.dataset.filter)));
updateEventTabs('all');

// ---------- Busca de equipamentos ----------
const equipmentSearch = document.querySelector('#equipment-search');
const equipmentResults = document.querySelector('#equipment-results');

equipmentSearch?.addEventListener('input', () => {
    const term = equipmentSearch.value.trim().toLocaleLowerCase('pt-BR');
    const rows = [...document.querySelectorAll('#equipment-body tr:not(.empty-equipment)')];
    let visible = 0;
    rows.forEach((row) => {
        const match = row.textContent.toLocaleLowerCase('pt-BR').includes(term);
        row.hidden = !match;
        if (match) visible += 1;
    });
    document.querySelector('.empty-equipment').hidden = visible !== 0;
    equipmentResults.textContent = `${visible} equipamento${visible === 1 ? '' : 's'} encontrado${visible === 1 ? '' : 's'}`;
});

// ---------- Abas de qualidade dos dados ----------
const dqTabs = document.querySelectorAll('.tab[data-dq-filter]');
const dqRows = () => [...document.querySelectorAll('#dataquality-body tr[data-dq]')];

function updateDqTabs(filter) {
    dqRows().forEach((row) => { row.hidden = !(filter === 'all' || row.dataset.dq === filter); });
    dqTabs.forEach((tab) => {
        const active = tab.dataset.dqFilter === filter;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
}

dqTabs.forEach((tab) => tab.addEventListener('click', () => updateDqTabs(tab.dataset.dqFilter)));

// ---------- Busca de profissionais ----------
const peopleSearch = document.querySelector('#people-search');
const peopleResults = document.querySelector('#people-results');

peopleSearch?.addEventListener('input', () => {
    const term = peopleSearch.value.trim().toLocaleLowerCase('pt-BR');
    const rows = [...document.querySelectorAll('#people-body tr:not(.empty-people)')];
    let visible = 0;
    rows.forEach((row) => {
        const match = row.textContent.toLocaleLowerCase('pt-BR').includes(term);
        row.hidden = !match;
        if (match) visible += 1;
    });
    document.querySelector('.empty-people').hidden = visible !== 0;
    peopleResults.textContent = `${visible} profissional${visible === 1 ? '' : 'is'} encontrado${visible === 1 ? '' : 's'}`;
});

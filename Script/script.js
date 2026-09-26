const stages = { login: document.querySelector('#stage-login'), launcher: document.querySelector('#stage-launcher'), app: document.querySelector('#stage-app') };

function showStage(name) {
    Object.entries(stages).forEach(([key, el]) => { el.hidden = key !== name; });
    window.scrollTo({ top: 0 });
}

document.querySelector('#login-submit').addEventListener('click', () => {
    // Validação local (mock). A troca por autenticação via banco de dados fica para a próxima etapa.
    showStage('launcher');
});

document.querySelectorAll('.launcher-tile').forEach((tile) => tile.addEventListener('click', () => {
    showStage('app');
    showView(tile.dataset.launch);
}));

document.querySelector('#open-launcher').addEventListener('click', () => showStage('launcher'));
document.querySelector('#launcher-logout').addEventListener('click', () => showStage('login'));

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

function textOr(value, fallback) { return value.trim() || fallback; }
document.querySelector('#save-equipment').addEventListener('click', () => {
    const name = textOr(document.querySelector('#eq-name').value, 'Novo equipamento');
    const category = document.querySelector('#eq-category').value;
    const amount = document.querySelector('#eq-amount').value || 1;
    const rest = document.querySelector('#eq-rest').checked ? 'Sim' : 'Não';
    document.querySelector('#equipment-body').insertAdjacentHTML('afterbegin', `<tr><td data-label="Equipamento">${name}</td><td data-label="Categoria"><span class="pill">${category}</span></td><td data-label="Quantidade">${amount}</td><td data-label="Dia de folga">${rest}</td><td data-label="Disponível"><b class="available">${amount} unidade(s)</b></td><td data-label="Ações"><button class="more" aria-label="Mais ações para ${name}">•••</button></td></tr>`);
});

document.querySelector('#save-person').addEventListener('click', () => {
    const name = textOr(document.querySelector('#person-name').value, 'Novo profissional');
    const skills = textOr(document.querySelector('#person-skills').value, 'sem habilitação');
    const days = document.querySelector('#person-days').value;
    document.querySelector('#people-body').insertAdjacentHTML('afterbegin', `<tr><td data-label="Profissional">${name}</td><td data-label="Habilitações"><span class="pill">${skills}</span></td><td data-label="Disponibilidade">${days}</td><td data-label="Próxima escala"><b class="available">Livre</b></td><td data-label="Ações"><button class="more">•••</button></td></tr>`);
});

function formatExecutionRange(startValue, endValue) {
    if (!startValue) return 'A definir';
    if (!endValue || endValue === startValue) return startValue;
    const days = Math.round((new Date(endValue) - new Date(startValue)) / 86400000) + 1;
    return `${startValue} a ${endValue} (${days} dias)`;
}

document.querySelector('#save-event').addEventListener('click', () => {
    const name = textOr(document.querySelector('#event-name').value, 'Novo evento');
    const build = document.querySelector('#event-build').value || 'A definir';
    const live = formatExecutionRange(document.querySelector('#event-live-start').value, document.querySelector('#event-live-end').value);
    const strike = document.querySelector('#event-strike').value || 'A definir';
    document.querySelector('#event-body').insertAdjacentHTML('afterbegin', `<tr data-status="proposta"><td data-label="Evento">${name}</td><td data-label="Montagem">${build}</td><td data-label="Execução">${live}</td><td data-label="Desmontagem">${strike}</td><td data-label="Itens">Sem itens</td><td data-label="Status"><span class="tag planned">Proposta</span></td><td data-label="Ações"><button class="text-button" data-go="allocation">Alocar →</button></td></tr>`);
    document.querySelectorAll('#event-body [data-go]').forEach((button) => { if (!button.dataset.bound) { button.addEventListener('click', () => showView(button.dataset.go)); button.dataset.bound = 'true'; } });
    updateEventTabs('proposta');
});

const eventTabs = document.querySelectorAll('.tab[data-filter]');
const eventRows = () => [...document.querySelectorAll('#event-body tr[data-status]')];
const eventSummary = document.querySelector('#events-summary');
const emptyEvents = document.querySelector('.empty-events');
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
    emptyEvents.hidden = visible !== 0;
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

const equipmentSearch = document.querySelector('#equipment-search');
const equipmentResults = document.querySelector('#equipment-results');
const emptyEquipment = document.querySelector('.empty-equipment');

equipmentSearch?.addEventListener('input', () => {
    const term = equipmentSearch.value.trim().toLocaleLowerCase('pt-BR');
    const rows = [...document.querySelectorAll('#equipment-body tr:not(.empty-equipment)')];
    let visible = 0;
    rows.forEach((row) => {
        const match = row.textContent.toLocaleLowerCase('pt-BR').includes(term);
        row.hidden = !match;
        if (match) visible += 1;
    });
    emptyEquipment.hidden = visible !== 0;
    equipmentResults.textContent = `${visible} equipamento${visible === 1 ? '' : 's'} encontrado${visible === 1 ? '' : 's'}`;
});

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

const peopleSearch = document.querySelector('#people-search');
const peopleResults = document.querySelector('#people-results');
const emptyPeople = document.querySelector('.empty-people');

peopleSearch?.addEventListener('input', () => {
    const term = peopleSearch.value.trim().toLocaleLowerCase('pt-BR');
    const rows = [...document.querySelectorAll('#people-body tr:not(.empty-people)')];
    let visible = 0;
    rows.forEach((row) => {
        const match = row.textContent.toLocaleLowerCase('pt-BR').includes(term);
        row.hidden = !match;
        if (match) visible += 1;
    });
    emptyPeople.hidden = visible !== 0;
    peopleResults.textContent = `${visible} profissional${visible === 1 ? '' : 'is'} encontrado${visible === 1 ? '' : 's'}`;
});

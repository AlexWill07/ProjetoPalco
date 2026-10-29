// Script/script.js
// Controla a interface: navegação entre ecrãs, janelas modais, filtros e mapa de ocupação.

// ---------- Palcos (login / launcher / app) ----------
function showStage(nome) {
    document.getElementById('stage-login').hidden = nome !== 'login';
    document.getElementById('stage-launcher').hidden = nome !== 'launcher';
    document.getElementById('stage-app').hidden = nome !== 'app';
}
window.showStage = showStage; // usado também pelo offline.js

// ---------- Usuário logado (saudação, iniciais e nome) ----------
window.applyUser = function (user) {
    const email = user?.email || '';
    const bruto = user?.user_metadata?.full_name || email.split('@')[0] || 'Operador';
    const nome = bruto.replace(/[._-]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()).trim() || 'Operador';
    const partes = nome.split(/\s+/);
    const iniciais = ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : (partes[0]?.[1] || ''))).toUpperCase();
    const h = new Date().getHours();
    const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = partes[0]; });
    document.querySelectorAll('[data-user-initials]').forEach((el) => { el.textContent = iniciais; });
    document.querySelectorAll('[data-greeting]').forEach((el) => { el.textContent = `${saudacao}, ${partes[0]}.`; });
};

// ---------- Navegação entre as telas (views) ----------
function showView(targetId) {
    const alvo = document.getElementById(targetId);
    if (!alvo || !alvo.classList.contains('view')) return;
    showStage('app');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    alvo.classList.add('active');

    document.querySelectorAll('.menu-item').forEach((m) => m.classList.remove('active'));
    const menuItem = document.querySelector(`.menu-item[data-view="${targetId}"]`);
    if (menuItem) {
        menuItem.classList.add('active');
        const titulo = menuItem.querySelector('span')?.textContent || menuItem.textContent;
        const h1 = document.getElementById('page-title');
        if (h1) h1.textContent = titulo;
        const crumb = document.getElementById('crumb');
        if (crumb) crumb.textContent = titulo.toUpperCase();
    }
    window.scrollTo({ top: 0 });
}

// ---------- Abas de eventos (filtro por fase) ----------
function applyEventFilter() {
    const aba = document.querySelector('#events .tab[data-filter].active');
    if (!aba) return;
    const filtro = aba.dataset.filter;
    const linhas = [...document.querySelectorAll('#event-body tr[data-status]')];
    let visiveis = 0;
    linhas.forEach((tr) => {
        const mostra = filtro === 'all' || tr.dataset.status === filtro;
        tr.style.display = mostra ? '' : 'none';
        if (mostra) visiveis += 1;
    });
    const vazio = document.querySelector('#event-body .empty-events');
    if (vazio) vazio.hidden = visiveis > 0;

    const resumo = document.getElementById('events-summary');
    if (resumo) {
        const rotulo = aba.firstChild?.textContent.trim() || 'Eventos';
        resumo.querySelector('.summary-icon').textContent = visiveis;
        resumo.querySelector('b').textContent = filtro === 'all' ? 'Todos os eventos' : `Eventos: ${rotulo}`;
        resumo.querySelector('small').textContent = `${visiveis} ${visiveis === 1 ? 'evento exibido' : 'eventos exibidos'}`;
    }
}

// ---------- Abas de qualidade dos dados (filtro por tipo) ----------
window.updateDqTabs = function (filtro) {
    document.querySelectorAll('#dataquality-body tr[data-dq]').forEach((tr) => {
        tr.style.display = filtro === 'all' || tr.dataset.dq === filtro ? '' : 'none';
    });
};

// ---------- Interface compartilhada com o app.js ----------
window.PalcoUI = {
    // Chamado a cada renderEventos(): atualiza os números das abas e reaplica o filtro ativo.
    refreshEvents() {
        const linhas = [...document.querySelectorAll('#event-body tr[data-status]')];
        document.querySelectorAll('#events .tab[data-filter]').forEach((aba) => {
            const f = aba.dataset.filter;
            const n = f === 'all' ? linhas.length : linhas.filter((tr) => tr.dataset.status === f).length;
            const b = aba.querySelector('b');
            if (b) b.textContent = n;
        });
        applyEventFilter();
    },
    // Reaplica a busca digitada nas tabelas de equipamentos e profissionais.
    refreshSearch() {
        [['#equipment-search', '#equipment-body', '.empty-equipment', '#equipment-results', 'equipamentos'],
         ['#people-search', '#people-body', '.empty-people', '#people-results', 'profissionais']].forEach(([inp, corpo, vazio, resumo, nome]) => {
            const campo = document.querySelector(inp);
            const termo = (campo?.value || '').trim().toLowerCase();
            const linhas = [...document.querySelectorAll(`${corpo} tr:not(${vazio})`)];
            let n = 0;
            linhas.forEach((tr) => {
                const mostra = !termo || tr.textContent.toLowerCase().includes(termo);
                tr.style.display = mostra ? '' : 'none';
                if (mostra) n += 1;
            });
            const msg = document.querySelector(`${corpo} ${vazio}`);
            if (msg) msg.hidden = n > 0 || linhas.length === 0;
            const info = document.querySelector(resumo);
            if (info) info.textContent = `Exibindo ${n} ${nome}`;
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {

    // 1. Login simulado -> abre o Launcher
    document.getElementById('login-submit')?.addEventListener('click', (e) => {
        e.preventDefault();
        const email = (document.getElementById('login-user')?.value || '').trim();
        window.applyUser({ email: email || 'operador@palcovivo.com.br' });
        showStage('launcher');
        if (typeof initApp === 'function') initApp();
    });

    // 2. Navegação: menu lateral, grade do launcher e qualquer botão [data-go]
    document.addEventListener('click', (e) => {
        const alvoEl = e.target.closest('.menu-item, .launcher-tile, [data-go]');
        if (!alvoEl) return;
        const id = alvoEl.dataset.view || alvoEl.dataset.launch || alvoEl.dataset.go;
        if (id) showView(id);
    });

    document.getElementById('open-launcher')?.addEventListener('click', () => showStage('launcher'));
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.getElementById('stage-app').classList.toggle('collapsed');
    });

    // Sair
    [document.getElementById('launcher-logout'), document.getElementById('app-logout')].forEach((btn) => {
        btn?.addEventListener('click', () => showStage('login'));
    });

    // 3. Janelas modais
    document.addEventListener('click', (e) => {
        const abrir = e.target.closest('[data-modal]');
        if (abrir) document.getElementById(abrir.dataset.modal)?.showModal();
        const fechar = e.target.closest('dialog .close');
        if (fechar) fechar.closest('dialog').close();
    });

    // 4. Abas: eventos (data-filter) e qualidade dos dados (data-dq-filter)
    document.querySelectorAll('.tabs .tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            tab.closest('.tabs').querySelectorAll('.tab').forEach((t) => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            if (tab.dataset.filter) applyEventFilter();
            if (tab.dataset.dqFilter) window.updateDqTabs(tab.dataset.dqFilter);
        });
    });

    // 5. Busca nas tabelas
    document.querySelector('#equipment-search')?.addEventListener('input', () => window.PalcoUI.refreshSearch());
    document.querySelector('#people-search')?.addEventListener('input', () => window.PalcoUI.refreshSearch());

    // 6. Navegação semanal do mapa de ocupação
    document.getElementById('map-prev')?.addEventListener('click', () => PalcoLive.moveWeeks(-1));
    document.getElementById('map-next')?.addEventListener('click', () => PalcoLive.moveWeeks(1));
});

// ---------- Mapa de ocupação (semana a semana) ----------
// Linhas: equipamentos e profissionais com reservas. Colunas: os 7 dias da semana mostrada.
// Célula "busy" = recurso reservado no dia (período montagem → desmontagem do evento);
// "conflict" = reservas do mesmo equipamento somam mais que o estoque.
window.PalcoLive = (() => {
    let inicioSemana = null;
    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const abrev = (d) => `${String(d.getDate()).padStart(2, '0')} ${MESES_ABREV[d.getMonth()].toLowerCase()}`;

    // Abre na semana do próximo evento (ou do último, se todos já passaram).
    function semanaInicial() {
        const hoje = hojeLocal();
        const periodos = data.eventos.map(periodoReserva).filter(Boolean).sort((a, b) => a.ini - b.ini);
        if (!periodos.length) return inicioDaSemana(hoje);
        const atual = periodos.find((p) => p.fim >= hoje);
        return inicioDaSemana(atual ? (atual.ini > hoje ? atual.ini : hoje) : periodos[periodos.length - 1].ini);
    }

    function refresh() {
        const mapa = document.getElementById('occupancy');
        if (!mapa || typeof data === 'undefined' || !data) return;
        if (!inicioSemana) inicioSemana = semanaInicial();

        const dias = Array.from({ length: 7 }, (_, i) => addDias(inicioSemana, i));
        const rotulo = document.getElementById('map-month');
        if (rotulo) rotulo.textContent = `${abrev(dias[0])} – ${abrev(dias[6])} ${dias[6].getFullYear()}`;
        document.getElementById('map-prev')?.setAttribute('aria-label', 'Semana anterior');
        document.getElementById('map-next')?.setAttribute('aria-label', 'Próxima semana');

        const cabecalho = `<div class="days head"><b>Recurso</b>${dias.map((d, i) => `<b>${DIAS[i]} ${String(d.getDate()).padStart(2, '0')}</b>`).join('')}</div>`;
        const secao = (t) => `<div class="days head map-section"><b>${t}</b></div>`;
        const noDia = (ev, d) => { const p = periodoReserva(ev); return p && p.ini <= d && d <= p.fim; };

        // Equipamentos
        const linhasEq = data.equipamentos.map((eq) => {
            const aloc = data.alocacoes.filter((a) => a.equipamento_id === eq.id);
            if (!aloc.length) return '';
            const avariadas = data.conferencias.filter((c) => aloc.some((a) => a.id === c.alocacao_id)).reduce((s, c) => s + c.quantidade_avariada, 0);
            const celulas = dias.map((d) => {
                const doDia = aloc.filter((a) => { const ev = data.eventos.find((e) => e.id === a.evento_id); return ev && noDia(ev, d); });
                if (!doDia.length) return '<i></i>';
                const usado = doDia.reduce((s, a) => s + a.quantidade, 0);
                const nomes = doDia.map((a) => data.eventos.find((e) => e.id === a.evento_id)?.nome).join(', ');
                const cap = capacidadeNoPeriodo(eq, { ini: d, fim: d }); // desconta unidades em manutenção
                return `<i class="${usado > cap ? 'conflict' : 'busy'}" title="${esc(nomes)}">${usado}/${cap}</i>`;
            }).join('');
            return `<div class="days"><strong>${esc(eq.nome)}<small>${eq.quantidade} un.${avariadas ? ` · ${avariadas} em manutenção` : ''}</small></strong>${celulas}</div>`;
        }).join('');

        // Equipe
        const linhasPessoas = data.profissionais.map((p) => {
            const escalas = data.escalas.filter((s) => s.profissional_id === p.id);
            if (!escalas.length) return '';
            const celulas = dias.map((d) => {
                const evs = escalas.map((s) => data.eventos.find((e) => e.id === s.evento_id)).filter((ev) => ev && noDia(ev, d));
                if (!evs.length) return '<i></i>';
                const cls = evs.length > 1 ? 'conflict' : 'busy'; // duas escalas no mesmo dia = conflito
                return `<i class="${cls}" title="${esc(evs.map((e) => e.nome).join(', '))}">${esc(evs[0].nome)}</i>`;
            }).join('');
            return `<div class="days"><strong>${esc(p.nome)}<small>${escalas.length} ${escalas.length === 1 ? 'escala' : 'escalas'}</small></strong>${celulas}</div>`;
        }).join('');

        mapa.innerHTML = (linhasEq || linhasPessoas)
            ? cabecalho + (linhasEq ? secao('Equipamentos') + linhasEq : '') + (linhasPessoas ? secao('Equipe') + linhasPessoas : '')
            : '<div style="padding:24px;color:var(--mu)">Nenhuma reserva para exibir. Aloque equipamentos ou escale a equipe em um evento.</div>';
    }

    function moveWeeks(n) {
        if (!inicioSemana) inicioSemana = semanaInicial();
        inicioSemana = addDias(inicioSemana, n * 7);
        refresh();
    }

    return { refresh, moveWeeks };
})();
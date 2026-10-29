// Script/offline.js
// Modo offline: login local + banco de dados de demonstração salvo no navegador (localStorage).
// Funciona sem o Supabase. As alterações feitas aqui NÃO são enviadas ao banco real.
(() => {
    const MODE_KEY = 'pv_offline';        // sessionStorage: esta aba está em modo offline
    const NAME_KEY = 'pv_offline_name';
    const DB_KEY = 'pv_offline_db';       // localStorage: dados locais (sobrevivem ao recarregar)
    const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

    const uuid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
    const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

    // ---------- Dados de exemplo (mesmos do schema.sql) ----------
    function seed() {
        const now = new Date().toISOString();
        return {
            categorias: [
                { id: id(101), nome: 'Som', exige_folga: true }, { id: id(102), nome: 'Luz', exige_folga: true },
                { id: id(103), nome: 'Estrutura', exige_folga: false }, { id: id(104), nome: 'Energia', exige_folga: true }
            ],
            habilidades: [
                { id: id(201), nome: 'som' }, { id: id(202), nome: 'luz' }, { id: id(203), nome: 'montagem' },
                { id: id(204), nome: 'cerimonial' }, { id: id(205), nome: 'energia' }
            ],
            funcoes: [
                { id: id(301), nome: 'Operador de luz', habilidade_id: id(202) }, { id: id(302), nome: 'Operador de som', habilidade_id: id(201) },
                { id: id(303), nome: 'Cerimonial', habilidade_id: id(204) }, { id: id(304), nome: 'Montagem', habilidade_id: id(203) }
            ],
            equipamentos: [
                { id: id(401), nome: 'Mesa de som 32 canais', categoria_id: id(101), quantidade: 3, exige_folga: true, criado_em: now },
                { id: id(402), nome: 'Moving head', categoria_id: id(102), quantidade: 16, exige_folga: true, criado_em: now },
                { id: id(403), nome: 'Praticável 2x1m', categoria_id: id(103), quantidade: 24, exige_folga: false, criado_em: now },
                { id: id(404), nome: 'Refletor PAR LED (12un.)', categoria_id: null, quantidade: 12, exige_folga: true, criado_em: now },
                { id: id(405), nome: 'Gerador 15kVA', categoria_id: null, quantidade: 2, exige_folga: true, criado_em: now },
                { id: id(406), nome: 'Tablado 1x1m', categoria_id: null, quantidade: 10, exige_folga: false, criado_em: now }
            ],
            profissionais: [
                { id: id(501), nome: 'Ivan Marcondes', dias_disponiveis: [5, 6, 7], criado_em: now },
                { id: id(502), nome: 'Priscila Amado', dias_disponiveis: [1, 2, 3, 4, 5, 6, 7], criado_em: now },
                { id: id(503), nome: 'Denilson Rocha', dias_disponiveis: [3, 4, 5, 6], criado_em: now }
            ],
            profissional_habilidades: [
                { profissional_id: id(501), habilidade_id: id(201) }, { profissional_id: id(501), habilidade_id: id(203) },
                { profissional_id: id(502), habilidade_id: id(204) }, { profissional_id: id(503), habilidade_id: id(202) },
                { profissional_id: id(503), habilidade_id: id(203) }
            ],
            eventos: [
                { id: id(601), nome: 'Casamento Ferreira', data_montagem: '2026-10-16', data_execucao_inicio: '2026-10-17', data_execucao_fim: '2026-10-17', data_desmontagem: '2026-10-18', status: 'escalado', criado_em: now },
                { id: id(602), nome: 'Formatura Unicastelo', data_montagem: '2026-10-17', data_execucao_inicio: '2026-10-18', data_execucao_fim: '2026-10-18', data_desmontagem: '2026-10-19', status: 'escalado', criado_em: now },
                { id: id(603), nome: 'Festival Aurora', data_montagem: '2026-10-24', data_execucao_inicio: '2026-10-25', data_execucao_fim: '2026-10-27', data_desmontagem: '2026-10-28', status: 'proposta', criado_em: now }
            ],
            alocacoes: [
                { id: id(701), evento_id: id(601), equipamento_id: id(401), quantidade: 2 }, { id: id(702), evento_id: id(601), equipamento_id: id(402), quantidade: 8 },
                { id: id(703), evento_id: id(602), equipamento_id: id(401), quantidade: 2 }, { id: id(704), evento_id: id(602), equipamento_id: id(402), quantidade: 8 },
                { id: id(705), evento_id: id(603), equipamento_id: id(403), quantidade: 24 }
            ],
            escalas: [
                { id: id(801), evento_id: id(601), profissional_id: id(503), funcao_id: id(304) },
                { id: id(802), evento_id: id(602), profissional_id: id(503), funcao_id: id(301) },
                { id: id(803), evento_id: id(602), profissional_id: id(502), funcao_id: id(303) }
            ],
            conferencias: [
                { id: id(901), alocacao_id: id(701), quantidade_retornada: 2, quantidade_avariada: 0, observacao: null, conferido_em: now },
                { id: id(902), alocacao_id: id(702), quantidade_retornada: 6, quantidade_avariada: 2, observacao: null, conferido_em: now }
            ]
        };
    }

    // ---------- Armazenamento local ----------
    let store = null;
    function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(store)); } catch { /* sem espaço/permisão: segue só em memória */ } }
    function load() {
        if (store) return store;
        try { store = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch { store = null; }
        if (!store || !Array.isArray(store.eventos)) { store = seed(); save(); }
        return store;
    }

    // ---------- Regras do banco (espelham o schema.sql) ----------
    const nowIso = () => new Date().toISOString();
    const STATUS = ['proposta', 'contratado', 'escalado', 'em_execucao', 'encerrado', 'bloqueado', 'pendente_retorno'];
    const SCHEMA = {
        categorias: { required: ['nome'], unique: ['nome'], defaults: () => ({ exige_folga: false }) },
        habilidades: { required: ['nome'], unique: ['nome'], defaults: () => ({}) },
        funcoes: { required: ['nome'], unique: ['nome'], defaults: () => ({ habilidade_id: null }) },
        equipamentos: { required: ['nome'], defaults: () => ({ categoria_id: null, quantidade: 1, exige_folga: false, criado_em: nowIso() }), check: (r) => r.quantidade >= 0 },
        profissionais: { required: ['nome'], defaults: () => ({ dias_disponiveis: [...ALL_DAYS], criado_em: nowIso() }) },
        profissional_habilidades: { noId: true, pk: ['profissional_id', 'habilidade_id'], required: ['profissional_id', 'habilidade_id'], defaults: () => ({}) },
        eventos: { required: ['nome'], defaults: () => ({ data_montagem: null, data_execucao_inicio: null, data_execucao_fim: null, data_desmontagem: null, status: 'proposta', criado_em: nowIso() }), check: (r) => STATUS.includes(r.status) },
        alocacoes: { required: ['evento_id', 'equipamento_id', 'quantidade'], defaults: () => ({}), check: (r) => r.quantidade > 0 },
        escalas: { required: ['evento_id', 'profissional_id'], defaults: () => ({ funcao_id: null }) },
        conferencias: { required: ['alocacao_id'], defaults: () => ({ quantidade_retornada: 0, quantidade_avariada: 0, observacao: null, conferido_em: null }), check: (r) => r.quantidade_retornada >= 0 && r.quantidade_avariada >= 0 }
    };
    const FKS = {
        equipamentos: [['categoria_id', 'categorias']], funcoes: [['habilidade_id', 'habilidades']],
        profissional_habilidades: [['profissional_id', 'profissionais'], ['habilidade_id', 'habilidades']],
        alocacoes: [['evento_id', 'eventos'], ['equipamento_id', 'equipamentos']],
        escalas: [['evento_id', 'eventos'], ['profissional_id', 'profissionais'], ['funcao_id', 'funcoes']],
        conferencias: [['alocacao_id', 'alocacoes']]
    };
    const CASCADE = { // on delete cascade
        eventos: [['alocacoes', 'evento_id'], ['escalas', 'evento_id']], equipamentos: [['alocacoes', 'equipamento_id']],
        alocacoes: [['conferencias', 'alocacao_id']], profissionais: [['profissional_habilidades', 'profissional_id'], ['escalas', 'profissional_id']],
        habilidades: [['profissional_habilidades', 'habilidade_id']]
    };
    const RESTRICT = { habilidades: [['funcoes', 'habilidade_id']], funcoes: [['escalas', 'funcao_id']] }; // impede apagar se em uso

    const dbError = (message, code) => Object.assign(new Error(message), { pg: true, code });

    function validate(table, row, self) {
        const s = load();
        const cfg = SCHEMA[table];
        cfg.required.forEach((c) => { if (row[c] === undefined || row[c] === null || row[c] === '') throw dbError(`null value in column "${c}" of relation "${table}" violates not-null constraint`, '23502'); });
        if (cfg.check && !cfg.check(row)) throw dbError(`new row for relation "${table}" violates check constraint`, '23514');
        (cfg.unique || []).forEach((c) => { if (s[table].some((r) => r !== self && r[c] === row[c])) throw dbError(`duplicate key value violates unique constraint "${table}_${c}_key"`, '23505'); });
        if (cfg.pk && s[table].some((r) => r !== self && cfg.pk.every((c) => r[c] === row[c]))) throw dbError(`duplicate key value violates unique constraint "${table}_pkey"`, '23505');
        (FKS[table] || []).forEach(([col, ref]) => { if (row[col] != null && !s[ref].some((r) => r.id === row[col])) throw dbError(`insert or update on table "${table}" violates foreign key constraint`, '23503'); });
    }

    function removeRows(table, rows) {
        const s = load();
        (RESTRICT[table] || []).forEach(([child, col]) => {
            if (s[child].some((r) => rows.some((p) => p.id === r[col]))) throw dbError(`update or delete on table "${table}" violates foreign key constraint on table "${child}"`, '23503');
        });
        (CASCADE[table] || []).forEach(([child, col]) => {
            const kids = s[child].filter((r) => rows.some((p) => p.id === r[col]));
            if (kids.length) removeRows(child, kids);
        });
        if (table === 'categorias') s.equipamentos.forEach((e) => { if (rows.some((p) => p.id === e.categoria_id)) e.categoria_id = null; });
        s[table] = s[table].filter((r) => !rows.includes(r));
    }

    // ---------- Imitação da API do Supabase (só o que o sistema usa) ----------
    function exec(table, op, payload, q) {
        try {
            const s = load();
            const match = (r) => q.filters.every(([c, v]) => r[c] === v);
            let result;
            if (op === 'select') {
                result = s[table].filter(match);
            } else if (op === 'insert') {
                const before = s[table].slice();
                result = [];
                try {
                    (Array.isArray(payload) ? payload : [payload]).forEach((item) => {
                        const row = { ...SCHEMA[table].defaults(), ...item };
                        if (!SCHEMA[table].noId && !row.id) row.id = uuid();
                        validate(table, row, null);
                        s[table].push(row);
                        result.push(row);
                    });
                } catch (e) { s[table] = before; throw e; }
            } else if (op === 'update') {
                const targets = s[table].filter(match);
                const updated = targets.map((r) => ({ ...r, ...payload }));
                updated.forEach((u, i) => validate(table, u, targets[i]));
                targets.forEach((r, i) => Object.assign(r, updated[i]));
                result = targets;
            } else {
                result = s[table].filter(match);
                removeRows(table, result);
            }
            if (op !== 'select') save();
            const rows = result.map((r) => JSON.parse(JSON.stringify(r)));
            if (q.single) {
                return rows.length === 1 ? { data: rows[0], error: null }
                    : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
            }
            return { data: q.rows ? rows : null, error: null };
        } catch (e) {
            return { data: null, error: { message: e.message || String(e), code: e.code || 'OFFLINE' } };
        }
    }

    function from(table) {
        const mk = (op, payload) => {
            const q = { filters: [], rows: op === 'select', single: false };
            const b = {
                eq(col, val) { q.filters.push([col, val]); return b; },
                select() { q.rows = true; return b; },
                single() { q.rows = true; q.single = true; return b; },
                then(resolve, reject) {
                    return Promise.resolve()
                        .then(() => (SCHEMA[table] ? exec(table, op, payload, q) : { data: null, error: { message: `relation "${table}" does not exist`, code: '42P01' } }))
                        .then(resolve, reject);
                }
            };
            return b;
        };
        return { select: () => mk('select'), insert: (p) => mk('insert', p), update: (p) => mk('update', p), delete: () => mk('delete') };
    }

    // ---------- Estado do modo offline ----------
    const storage = (fn) => { try { return fn(); } catch { return null; } };
    const Offline = {
        from,
        get active() { return storage(() => sessionStorage.getItem(MODE_KEY)) === '1'; },
        get session() {
            const name = storage(() => sessionStorage.getItem(NAME_KEY)) || 'Operador';
            return { offline: true, user: { id: 'offline', email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@offline.local`, user_metadata: { full_name: name } } };
        },
        enter(name) {
            storage(() => { sessionStorage.setItem(MODE_KEY, '1'); sessionStorage.setItem(NAME_KEY, name || 'Operador'); });
            load();
            renderBanner();
        },
        leave() {
            storage(() => { sessionStorage.removeItem(MODE_KEY); sessionStorage.removeItem(NAME_KEY); });
            renderBanner();
        },
        reset() { store = seed(); save(); }
    };

    // ---------- Aviso de modo offline + botão no login ----------
    const style = document.createElement('style');
    style.textContent = `
#offline-banner{position:fixed;inset:0 0 auto 0;z-index:200;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 16px;background:linear-gradient(90deg,#f4b41a,#ff8a50);color:#1a1529;font:600 12.5px/1.3 var(--font,system-ui,sans-serif)}
#offline-banner .offline-text{font-weight:500;flex:1 1 260px}
#offline-banner .offline-dot{width:8px;height:8px;border-radius:50%;background:#1a1529}
#offline-banner button{border:1px solid rgba(26,21,41,.35);background:rgba(255,255,255,.35);color:#1a1529;border-radius:8px;padding:4px 10px;font:600 12px var(--font,system-ui,sans-serif);cursor:pointer}
#offline-banner button:hover{background:rgba(255,255,255,.65)}
body.is-offline{padding-top:var(--offline-h,40px)}
body.is-offline .sidebar{top:var(--offline-h,40px)}
.offline-box{margin-top:14px;text-align:center}
.offline-btn{width:100%;padding:12px;border-radius:12px;border:1px dashed rgba(255,255,255,.28);background:transparent;color:var(--accent-2,#ff8a50);font:700 13px var(--font,system-ui,sans-serif);cursor:pointer}
.offline-btn:hover{background:rgba(255,138,80,.12)}
.offline-note{margin:8px 0 0;font-size:11px;line-height:1.4;color:var(--muted,#a59fbd)}`;
    document.head.appendChild(style);

    function renderBanner() {
        const on = Offline.active;
        document.body.classList.toggle('is-offline', on);
        let el = document.getElementById('offline-banner');
        if (!on) { el?.remove(); return; }
        if (!el) { el = document.createElement('div'); el.id = 'offline-banner'; el.setAttribute('role', 'status'); document.body.prepend(el); }
        el.innerHTML = `<span class="offline-dot"></span><b>Modo offline</b>
            <span class="offline-text">Você está usando dados de demonstração salvos neste navegador. Nada é enviado ao banco de dados.</span>
            <button type="button" data-offline-reset>Restaurar dados de exemplo</button>
            <button type="button" data-offline-exit>Voltar ao modo online</button>`;
        document.documentElement.style.setProperty('--offline-h', `${el.offsetHeight || 40}px`);
    }
    window.addEventListener('resize', () => { const el = document.getElementById('offline-banner'); if (el) document.documentElement.style.setProperty('--offline-h', `${el.offsetHeight}px`); });

    const submit = document.querySelector('#login-submit');
    if (submit) {
        const box = document.createElement('div');
        box.className = 'offline-box';
        box.innerHTML = `<button type="button" class="offline-btn" id="login-offline">Entrar em modo offline</button>
            <p class="offline-note">Sem conexão com o banco? Entre com dados de demonstração salvos neste navegador. Nada é enviado ao Supabase.</p>`;
        submit.insertAdjacentElement('afterend', box);
    }

    async function enterOffline() {
        const button = document.querySelector('#login-offline');
        const typed = (document.querySelector('#login-user')?.value || '').trim().split('@')[0];
        button.disabled = true;
        try {
            Offline.enter(typed || 'Operador');
            await initApp();
            if (typeof refreshEvents === 'function') refreshEvents();
            storage(() => sessionStorage.setItem('pv_tab_login', '1'));
            window.applyUser?.(Offline.session.user);
            const err = document.querySelector('#login-error');
            if (err) err.hidden = true;
            showStage('launcher');
        } catch (e) {
            console.error(e);
            Offline.leave();
            alert('Não foi possível iniciar o modo offline: ' + (e.message || e));
        } finally {
            button.disabled = false;
        }
    }

    document.addEventListener('click', async (event) => {
        if (event.target.closest('#login-offline')) { enterOffline(); return; }
        if (event.target.closest('[data-offline-exit]')) {
            Offline.leave();
            storage(() => sessionStorage.removeItem('pv_tab_login'));
            location.reload();
            return;
        }
        if (event.target.closest('[data-offline-reset]')) {
            if (!confirm('Restaurar os dados de exemplo? As alterações feitas no modo offline serão perdidas.')) return;
            Offline.reset();
            if (typeof refreshData === 'function') { await refreshData(); renderAll(); }
            const text = document.querySelector('#offline-banner .offline-text');
            if (text) { const old = text.textContent; text.textContent = 'Dados de exemplo restaurados.'; setTimeout(() => { text.textContent = old; }, 2500); }
        }
    });

    // Se o login falhar por falta de conexão, sugere o modo offline na própria mensagem de erro.
    const loginError = document.querySelector('#login-error');
    if (loginError) {
        new MutationObserver(() => {
            const t = loginError.textContent;
            if (!loginError.hidden && /fetch|conex|servidor|network/i.test(t) && !/modo offline/i.test(t)) {
                loginError.textContent = `${t} Você pode usar “Entrar em modo offline” abaixo para continuar com dados de demonstração.`;
            }
        }).observe(loginError, { childList: true, characterData: true, subtree: true });
    }

    window.PalcoOffline = Offline;
    renderBanner();
})();

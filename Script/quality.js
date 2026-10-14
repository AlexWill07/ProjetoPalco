// Script/quality.js
// Qualidade dos dados: calcula as inconsistências direto do banco (variável "data" do app.js)
// e permite corrigir cada uma de verdade (grava no Supabase).
(() => {
    const TAB_ORDER = { evento: 0, equipamento: 1, profissional: 2 };
    // Palavras ignoradas ao comparar habilitações: "Operador de som", "op. som" e "som" viram a mesma chave.
    const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'op', 'operador', 'operadora', 'tecnico', 'tecnica']);

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad2 = (n) => String(n).padStart(2, '0');
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    function normKey(text) {
        const words = String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
        return words.filter((w) => !STOP.has(w)).join(' ') || words.join(' ');
    }

    // ---------- Regras de detecção ----------
    function eventOrderProblem(e) {
        const m = e.data_montagem, i = e.data_execucao_inicio, f = e.data_execucao_fim || i, d = e.data_desmontagem;
        if (m && d && d < m) return 'Desmontagem cadastrada antes da montagem';
        if (m && i && i < m) return 'Execução começa antes da montagem';
        if (i && f && f < i) return 'Fim da execução antes do início';
        if (f && d && d < f) return 'Desmontagem cadastrada antes do fim da execução';
        return null;
    }

    const usesOf = (d, habilidadeId) => d.profHabilidades.filter((x) => x.habilidade_id === habilidadeId).length;

    function habilidadeGroups(d) {
        const map = new Map();
        d.habilidades.forEach((h) => {
            const k = normKey(h.nome);
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(h);
        });
        return [...map.values()].filter((g) => g.length > 1);
    }

    // Nome sugerido para manter: o mais usado; empate → o mais curto.
    function suggestedKeep(d, group) {
        return group.slice().sort((a, b) => usesOf(d, b.id) - usesOf(d, a.id) || a.nome.length - b.nome.length || a.nome.localeCompare(b.nome))[0];
    }

    function analyse(d) {
        const rows = [];
        d.eventos.forEach((e) => {
            const problem = eventOrderProblem(e);
            if (problem) rows.push({ kind: 'evento', id: e.id, tab: 'evento', tipo: 'Evento', registro: e.nome, problema: problem, prioridade: 'Alta' });
        });
        d.equipamentos.filter((q) => !q.categoria_id).forEach((q) => rows.push({
            kind: 'equipamento', id: q.id, tab: 'equipamento', tipo: 'Equipamento', registro: q.nome,
            problema: 'Sem categoria — folga (RN-02) não é aplicada', prioridade: q.exige_folga ? 'Alta' : 'Média'
        }));
        let divergent = 0;
        habilidadeGroups(d).forEach((group) => group.forEach((h) => {
            divergent += 1;
            const others = group.filter((x) => x !== h).map((x) => `"${x.nome}"`).join(' / ');
            const n = usesOf(d, h.id);
            rows.push({
                kind: 'habilidade', id: h.id, tab: 'profissional', tipo: 'Habilitação',
                registro: `"${h.nome}" · ${n ? plural(n, 'profissional', 'profissionais') : 'sem profissionais'}`,
                problema: `Grafia diferente de ${others} — tratadas como habilitações distintas`, prioridade: 'Média'
            });
        }));
        rows.sort((a, b) => TAB_ORDER[a.tab] - TAB_ORDER[b.tab] || (a.prioridade === b.prioridade ? 0 : a.prioridade === 'Alta' ? -1 : 1));
        const count = (tab) => rows.filter((r) => r.tab === tab).length;
        return {
            rows,
            cards: [count('evento'), count('equipamento'), divergent],
            tabs: { all: rows.length, evento: count('evento'), equipamento: count('equipamento'), profissional: count('profissional') }
        };
    }

    // ---------- Tela ----------
    function rowHtml(r) {
        const prio = r.prioridade === 'Alta' ? '<b class="unavailable">Alta</b>' : '<b class="pending">Média</b>';
        return `<tr data-dq="${r.tab}">
            <td data-label="Tipo"><span class="pill">${esc(r.tipo)}</span></td>
            <td data-label="Registro">${esc(r.registro)}</td>
            <td data-label="Problema">${esc(r.problema)}</td>
            <td data-label="Prioridade">${prio}</td>
            <td data-label="Ação"><button class="text-button" data-dq-fix="${r.kind}:${esc(r.id)}">Corrigir</button></td>
        </tr>`;
    }

    function render() {
        const body = document.querySelector('#dataquality-body');
        if (!body || typeof data === 'undefined' || !data) return;
        const { rows, cards, tabs } = analyse(data);
        body.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="5">Nenhuma inconsistência encontrada. Os dados estão consistentes.</td></tr>';
        document.querySelectorAll('#dataquality .stats strong').forEach((el, i) => { if (cards[i] !== undefined) el.textContent = pad2(cards[i]); });
        Object.entries(tabs).forEach(([filter, n]) => {
            const badge = document.querySelector(`.tab[data-dq-filter="${filter}"] b`);
            if (badge) badge.textContent = n;
        });
        const active = document.querySelector('.tab[data-dq-filter].active')?.dataset.dqFilter || 'all';
        if (typeof updateDqTabs === 'function') updateDqTabs(active);
    }

    // ---------- Correção (modal) ----------
    let dialog = null;
    let current = null;

    function ensureDialog() {
        if (dialog) return;
        dialog = document.createElement('dialog');
        dialog.id = 'dq-modal';
        dialog.innerHTML = `<form>
            <div class="modal-head"><h3 id="dq-title"></h3><button class="close" type="button" aria-label="Fechar">×</button></div>
            <div id="dq-fields" style="display:grid;gap:14px"></div>
            <p class="form-note" id="dq-error" style="color:var(--coral)" hidden></p>
            <button class="primary" type="submit" id="dq-save">Salvar correção</button>
        </form>`;
        document.body.appendChild(dialog);
        dialog.querySelector('form').addEventListener('submit', onSubmit);
    }

    const setError = (msg) => { const el = dialog.querySelector('#dq-error'); el.textContent = msg; el.hidden = !msg; };
    const fail = (msg) => Object.assign(new Error(msg), { validation: true });

    async function updateOne(table, values, id) {
        const { data: rows, error } = await db.from(table).update(values).eq('id', id).select();
        if (error) throw error;
        if (!rows || !rows.length) throw new Error('nenhum registro foi atualizado (verifique as permissões no Supabase)');
    }

    function openFix(kind, id) {
        ensureDialog();
        const fields = dialog.querySelector('#dq-fields');
        const title = dialog.querySelector('#dq-title');
        setError('');

        if (kind === 'evento') {
            const e = data.eventos.find((x) => x.id === id);
            if (!e) return;
            title.textContent = 'Corrigir datas do evento';
            fields.innerHTML = `<p class="form-note"><b>${esc(e.nome)}</b> — ${esc(eventOrderProblem(e) || 'datas conferidas')}.</p>
                <div class="form-grid">
                    <label>Montagem<input type="date" id="dq-m" value="${e.data_montagem || ''}"></label>
                    <label>Início da execução<input type="date" id="dq-i" value="${e.data_execucao_inicio || ''}"></label>
                    <label>Fim da execução<input type="date" id="dq-f" value="${e.data_execucao_fim || ''}"></label>
                    <label>Desmontagem<input type="date" id="dq-d" value="${e.data_desmontagem || ''}"></label>
                </div>
                <button type="button" class="text-button" id="dq-sort">Ordenar as datas automaticamente</button>`;
            fields.querySelector('#dq-sort').addEventListener('click', () => {
                const inputs = ['#dq-m', '#dq-i', '#dq-f', '#dq-d'].map((s) => fields.querySelector(s)).filter((x) => x.value);
                const sorted = inputs.map((x) => x.value).sort();
                inputs.forEach((x, k) => { x.value = sorted[k]; });
            });
            current = { save: async () => {
                const v = { data_montagem: fields.querySelector('#dq-m').value || null, data_execucao_inicio: fields.querySelector('#dq-i').value || null, data_execucao_fim: fields.querySelector('#dq-f').value || null, data_desmontagem: fields.querySelector('#dq-d').value || null };
                const problem = eventOrderProblem(v);
                if (problem) throw fail(problem + '. Ajuste as datas para a ordem: montagem → execução → desmontagem.');
                await updateOne('eventos', v, id);
            } };
        } else if (kind === 'equipamento') {
            const q = data.equipamentos.find((x) => x.id === id);
            if (!q) return;
            title.textContent = 'Definir categoria';
            fields.innerHTML = `<p class="form-note"><b>${esc(q.nome)}</b> — sem categoria, a regra de folga (RN-02) não é aplicada.</p>
                <label>Categoria<select id="dq-cat"><option value="">Selecione…</option>${data.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
                <label class="check"><input type="checkbox" id="dq-rest" ${q.exige_folga ? 'checked' : ''}> Exige dia de folga após a desmontagem</label>`;
            fields.querySelector('#dq-cat').addEventListener('change', (ev) => {
                const c = data.categorias.find((x) => x.id === ev.target.value);
                if (c) fields.querySelector('#dq-rest').checked = !!c.exige_folga; // regra padrão da categoria
            });
            current = { save: async () => {
                const categoria_id = fields.querySelector('#dq-cat').value;
                if (!categoria_id) throw fail('Selecione uma categoria.');
                await updateOne('equipamentos', { categoria_id, exige_folga: fields.querySelector('#dq-rest').checked }, id);
            } };
        } else if (kind === 'habilidade') {
            const h = data.habilidades.find((x) => x.id === id);
            const group = h && habilidadeGroups(data).find((g) => g.includes(h));
            if (!group) return;
            const keep = suggestedKeep(data, group);
            title.textContent = 'Unificar habilitações';
            fields.innerHTML = `<p class="form-note">Estas grafias serão unificadas em uma só. Profissionais e funções ligados às outras passam para o nome escolhido.</p>
                <label>Manter o nome<select id="dq-keep">${group.map((x) => `<option value="${x.id}" ${x === keep ? 'selected' : ''}>${esc(x.nome)} (${plural(usesOf(data, x.id), 'profissional', 'profissionais')})</option>`).join('')}</select></label>`;
            current = { save: async () => {
                const keepId = fields.querySelector('#dq-keep').value;
                for (const dup of group.filter((x) => x.id !== keepId)) await mergeHabilidade(keepId, dup.id);
            } };
        } else return;

        dialog.showModal();
    }

    // Move funções e profissionais da grafia duplicada para a escolhida e apaga a duplicada.
    async function mergeHabilidade(keepId, dupId) {
        let r = await db.from('funcoes').update({ habilidade_id: keepId }).eq('habilidade_id', dupId);
        if (r.error) throw r.error;
        for (const link of data.profHabilidades.filter((x) => x.habilidade_id === dupId)) {
            const already = data.profHabilidades.some((x) => x.profissional_id === link.profissional_id && x.habilidade_id === keepId);
            r = already
                ? await db.from('profissional_habilidades').delete().eq('profissional_id', link.profissional_id).eq('habilidade_id', dupId)
                : await db.from('profissional_habilidades').update({ habilidade_id: keepId }).eq('profissional_id', link.profissional_id).eq('habilidade_id', dupId);
            if (r.error) throw r.error;
            if (!already) link.habilidade_id = keepId;
        }
        r = await db.from('habilidades').delete().eq('id', dupId);
        if (r.error) throw r.error;
    }

    async function onSubmit(event) {
        event.preventDefault();
        const button = dialog.querySelector('#dq-save');
        setError('');
        button.disabled = true;
        button.textContent = 'Salvando…';
        try {
            await current.save();
            dialog.close();
            await refreshData();
            renderAll();
        } catch (err) {
            setError(err.validation ? err.message : 'Não foi possível salvar: ' + (err.message || err));
        } finally {
            button.disabled = false;
            button.textContent = 'Salvar correção';
        }
    }

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-dq-fix]');
        if (!button) return;
        const [kind, id] = button.dataset.dqFix.split(':');
        openFix(kind, id);
    });

    window.PalcoQuality = { refresh: render };
})();

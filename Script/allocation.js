// Script/allocation.js
// Alocação de equipamentos: cadastra/edita/remove alocações no banco e recalcula a tela
// (cartões, tabela, validação RN-01 estoque × período e RN-02 dia de folga) sempre que algo muda.
(() => {
    const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = (n) => String(n).padStart(2, '0');
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const listPt = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`);
    const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
    const fmtShort = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

    // ---------- Regras (RN-01 e RN-02) ----------
    const addDay = (iso) => {
        const [y, m, d] = iso.split('-').map(Number);
        const t = new Date(y, m - 1, d + 1);
        return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    };
    const span = (e) => ({ start: e.data_montagem || e.data_execucao_inicio, end: e.data_desmontagem || e.data_execucao_fim || e.data_execucao_inicio || e.data_montagem });
    const overlap = (a, b) => a.start <= b.end && b.start <= a.end;
    // RN-02: equipamento que exige folga fica bloqueado também no dia seguinte à desmontagem.
    const withRest = (s, eq) => (eq.exige_folga && s.end ? { start: s.start, end: addDay(s.end) } : s);

    // Quantas unidades de "eq" estão livres para o evento, descontando os OUTROS eventos que se sobrepõem.
    function freeFor(eventId, eq) {
        const ev = data.eventos.find((e) => e.id === eventId);
        const mine = withRest(span(ev), eq);
        const clashes = data.alocacoes
            .filter((o) => o.evento_id !== eventId && o.equipamento_id === eq.id)
            .map((o) => ({ qty: o.quantidade, ev: data.eventos.find((x) => x.id === o.evento_id) }))
            .filter((c) => c.ev && span(c.ev).start && overlap(mine, withRest(span(c.ev), eq)));
        const used = clashes.reduce((sum, c) => sum + c.qty, 0);
        return { used, free: Math.max(0, eq.quantidade - used), blockers: [...new Set(clashes.map((c) => c.ev.nome))] };
    }

    function evaluate(ev) {
        const base = span(ev);
        return data.alocacoes.filter((a) => a.evento_id === ev.id).map((a) => {
            const eq = data.equipamentos.find((q) => q.id === a.equipamento_id);
            if (!eq) return null;
            const f = freeFor(ev.id, eq);
            return { a, eq, ...f, ok: a.quantidade <= f.free, missing: Math.max(0, a.quantidade - f.free), rest: eq.exige_folga ? addDay(base.end) : null };
        }).filter(Boolean).sort((x, y) => x.eq.nome.localeCompare(y.eq.nome));
    }

    // ---------- Tela ----------
    let selectedId = null;
    const sortedEvents = () => data.eventos.filter((e) => span(e).start).sort((a, b) => (span(a).start < span(b).start ? -1 : 1));

    function render() {
        const view = document.querySelector('#allocation');
        if (!view || typeof data === 'undefined' || !data) return;
        const stats = view.querySelector('.allocation-stats');
        const panel = view.querySelector('.allocation-panel');
        const events = sortedEvents();
        if (!events.some((e) => e.id === selectedId)) {
            selectedId = (events.find((e) => data.alocacoes.some((a) => a.evento_id === e.id)) || events[0])?.id || null;
        }
        if (!selectedId) {
            stats.innerHTML = '';
            panel.innerHTML = '<p class="helper" style="padding:26px">Nenhum evento com datas de montagem e desmontagem. Cadastre ou corrija um evento primeiro.</p>';
            return;
        }

        const ev = data.eventos.find((e) => e.id === selectedId);
        const base = span(ev);
        const lines = evaluate(ev);
        const ok = lines.filter((l) => l.ok);
        const bad = lines.filter((l) => !l.ok);
        const sum = (arr) => arr.reduce((s, l) => s + l.a.quantidade, 0);

        stats.innerHTML = `
            <article><span>Itens solicitados</span><b>${sum(lines)}</b><small>${pl(lines.length, 'tipo', 'tipos')} de equipamento</small></article>
            <article><span>Itens disponíveis</span><b>${sum(ok)}</b><small>${ok.length ? `${esc(listPt(ok.map((l) => l.eq.nome)))} ${ok.length > 1 ? 'validados' : 'validado'}` : 'Nenhum item validado'}</small></article>
            <article class="${bad.length ? 'conflict-card' : ''}"><span>Itens bloqueados</span><b>${sum(bad)}</b><small>${bad.length ? `${esc(listPt(bad.map((l) => l.eq.nome)))} em conflito` : 'Nenhum conflito'}</small></article>`;

        // Caixa de validação (vermelha com conflito, verde sem conflito)
        let box;
        if (bad.length) {
            const detail = bad.map((l) => `${esc(l.eq.nome)}: faltam ${l.missing}${l.blockers.length ? ` (reservadas por ${esc(l.blockers.join(', '))})` : ''}`).join(' · ');
            box = `<div class="validation-box"><b>${pl(bad.length, 'conflito encontrado', 'conflitos encontrados')}</b><span>${detail}</span><button class="text-button" data-go="map">Ver no mapa de ocupação</button></div>`;
        } else if (lines.length) {
            box = `<div class="validation-box" style="background:var(--greenbg);border-color:rgba(79,224,160,.35)"><b style="color:var(--green)">Nenhum conflito</b><span>Todos os itens estão disponíveis no período, incluindo a folga.</span></div>`;
        } else {
            box = `<div class="validation-box" style="background:rgba(255,255,255,.04);border-color:var(--line)"><b>Nenhum item alocado</b><span>Use “+ Alocar equipamento” para vincular itens a este evento.</span></div>`;
        }

        const restCats = [...new Set(lines.filter((l) => l.eq.exige_folga).map((l) => (data.categorias.find((c) => c.id === l.eq.categoria_id)?.nome || 'sem categoria').toLowerCase()))];
        const rows = lines.map((l) => {
            const pct = l.eq.quantidade ? Math.min(100, Math.round(((l.used + l.a.quantidade) / l.eq.quantidade) * 100)) : 100;
            const bar = `<div style="height:6px;margin-top:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:${l.ok ? 'var(--grad)' : 'var(--coral)'}"></i></div>`;
            const validation = l.ok
                ? `<b class="available">Disponível</b><small class="cell-note">${pl(l.free, 'unidade livre', 'unidades livres')} no período</small>`
                : `<b class="unavailable">Indisponível · RN-01</b><small class="cell-note">${pl(l.free, 'unidade livre', 'unidades livres')}; faltam ${l.missing}</small>`;
            return `<tr>
                <td data-label="Equipamento">${esc(l.eq.nome)}</td>
                <td data-label="Quantidade">${l.a.quantidade}</td>
                <td data-label="Em estoque">${pl(l.eq.quantidade, 'unidade', 'unidades')}${bar}</td>
                <td data-label="Período reservado">${fmt(base.start)} — ${fmt(base.end)}</td>
                <td data-label="Folga">${l.rest ? fmt(l.rest) : '—'}</td>
                <td data-label="Validação">${validation}</td>
                <td data-label="Ações"><button class="text-button" data-alloc-edit="${esc(l.a.id)}">Alterar</button> <button class="text-button" data-alloc-del="${esc(l.a.id)}" style="color:var(--coral)">Remover</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="7">Nenhum equipamento alocado a este evento.</td></tr>';

        const footer = bad.length
            ? `<p><b>Para validar este evento:</b> reduza a quantidade ou remova os itens bloqueados até que todos estejam disponíveis.</p><span class="tag conflict">${pl(bad.length, 'item bloqueado', 'itens bloqueados')}</span>`
            : lines.length
                ? '<p><b>Alocação válida:</b> todos os itens estão disponíveis no período, incluindo a folga.</p><span class="tag confirmed">Alocação válida</span>'
                : '<p>Adicione equipamentos para validar este evento.</p>';

        panel.innerHTML = `
            <div class="allocation-top">
                <div><label for="allocation-event">Evento selecionado</label>
                    <select id="allocation-event">${events.map((e) => `<option value="${esc(e.id)}" ${e.id === selectedId ? 'selected' : ''}>${esc(e.nome)} · ${fmtShort(span(e).start)} a ${fmtShort(span(e).end)}</option>`).join('')}</select>
                    <small>Montagem: ${fmt(ev.data_montagem)} · Desmontagem: ${fmt(ev.data_desmontagem)}</small></div>
                ${box}
            </div>
            <div class="reservation-info">
                <div><span>Período de uso</span><b>${fmt(base.start)} → ${fmt(base.end)}</b></div>
                <div><span>Folga obrigatória</span><b>${restCats.length ? `${fmt(addDay(base.end))} para ${esc(listPt(restCats))}` : 'Nenhuma folga necessária'}</b></div>
                <div><span>Validação aplicada</span><b>RN-01 e RN-02</b></div>
            </div>
            <div class="table-wrap"><table>
                <thead><tr><th>Equipamento</th><th>Quantidade</th><th>Em estoque</th><th>Período reservado</th><th>Folga</th><th>Validação</th><th>Ações</th></tr></thead>
                <tbody id="allocation-body">${rows}</tbody>
            </table></div>
            <div class="allocation-footer">${footer}</div>`;
    }

    // ---------- Modal "Alocar equipamento" ----------
    let editId = null;
    const fail = (msg) => Object.assign(new Error(msg), { validation: true });

    function renderModal(editing = null) {
        const dialog = document.querySelector('#allocation-modal');
        if (!dialog || typeof data === 'undefined' || !data) return;
        const form = dialog.querySelector('form');
        form.id = 'allocation-form';
        editId = editing;
        const ev = data.eventos.find((e) => e.id === selectedId);
        const head = `<div class="modal-head"><h3>${editing ? 'Alterar quantidade' : 'Alocar equipamento'}</h3><button class="close" type="button" aria-label="Fechar">×</button></div>`;
        if (!ev) {
            form.innerHTML = `${head}<p class="form-note">Selecione um evento com datas de montagem e desmontagem antes de alocar.</p>`;
            return;
        }
        const line = editing ? data.alocacoes.find((a) => a.id === editing) : null;
        const b = span(ev);
        const options = data.equipamentos.slice().sort((x, y) => x.nome.localeCompare(y.nome))
            .map((q) => `<option value="${esc(q.id)}" ${line && line.equipamento_id === q.id ? 'selected' : ''}>${esc(q.nome)} · ${q.quantidade} em estoque</option>`).join('');
        form.innerHTML = `${head}
            <p class="form-note">Evento: <b>${esc(ev.nome)}</b> · ${fmt(b.start)} → ${fmt(b.end)}</p>
            <label>Equipamento<select id="al-eq" ${line ? 'disabled' : ''}>${options}</select></label>
            <label>Quantidade<input id="al-qty" type="number" min="1" step="1" value="${line ? line.quantidade : 1}"></label>
            <p class="form-note" id="al-hint"></p>
            <p class="form-note" id="al-error" style="color:var(--coral)" hidden></p>
            <button class="primary" type="submit" id="al-save">${line ? 'Salvar quantidade' : 'Validar e alocar'}</button>`;
        updateHint();
    }

    function currentTotal(eq, qty) {
        const existing = editId ? null : data.alocacoes.find((a) => a.evento_id === selectedId && a.equipamento_id === eq.id);
        return { existing, total: editId ? qty : (existing ? existing.quantidade : 0) + qty };
    }

    function updateHint() {
        const hint = document.querySelector('#al-hint');
        const select = document.querySelector('#al-eq');
        if (!hint || !select) return;
        const eq = data.equipamentos.find((q) => q.id === select.value);
        if (!eq) return;
        const qty = parseInt(document.querySelector('#al-qty').value, 10) || 0;
        const f = freeFor(selectedId, eq);
        const { existing, total } = currentTotal(eq, qty);
        const over = total > f.free;
        hint.textContent = `Livres no período${eq.exige_folga ? ' (com folga)' : ''}: ${f.free} de ${eq.quantidade}.${existing ? ` Já alocadas neste evento: ${existing.quantidade}.` : ''}${over ? ' Quantidade acima do disponível.' : ''}`;
        hint.style.color = over ? 'var(--coral)' : '';
    }

    async function save(form) {
        const eq = data.equipamentos.find((q) => q.id === form.querySelector('#al-eq').value);
        const qty = parseInt(form.querySelector('#al-qty').value, 10);
        if (!eq) throw fail('Selecione um equipamento.');
        if (!Number.isInteger(qty) || qty < 1) throw fail('Informe uma quantidade de pelo menos 1.');
        const { existing, total } = currentTotal(eq, qty);
        const f = freeFor(selectedId, eq);
        if (total > f.free) {
            throw fail(`Indisponível (RN-01): ${pl(f.free, 'unidade livre', 'unidades livres')} no período${eq.exige_folga ? ' (incluindo a folga)' : ''}, mas o total pedido é ${total}.${f.blockers.length ? ` Reservadas por: ${f.blockers.join(', ')}.` : ''}`);
        }
        const target = editId ? data.alocacoes.find((a) => a.id === editId) : existing;
        if (target) {
            const { data: rows, error } = await db.from('alocacoes').update({ quantidade: total }).eq('id', target.id).select();
            if (error) throw error;
            if (!rows || !rows.length) throw new Error('nenhum registro foi atualizado (verifique as permissões no Supabase)');
        } else {
            const { error } = await db.from('alocacoes').insert({ evento_id: selectedId, equipamento_id: eq.id, quantidade: total });
            if (error) throw error;
        }
    }

    async function reload() {
        await refreshData();
        renderAll(); // redesenha tudo: alocação, mapa, notificações e qualidade dos dados
    }

    // Antes do script.js abrir o modal, monta o formulário com os dados atuais.
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-modal="allocation-modal"]')) renderModal();
    }, true);

    document.addEventListener('click', async (event) => {
        const edit = event.target.closest('[data-alloc-edit]');
        if (edit) { renderModal(edit.dataset.allocEdit); document.querySelector('#allocation-modal')?.showModal(); return; }
        const del = event.target.closest('[data-alloc-del]');
        if (!del) return;
        const line = data.alocacoes.find((a) => a.id === del.dataset.allocDel);
        const eq = line && data.equipamentos.find((q) => q.id === line.equipamento_id);
        const hasReturn = line && data.conferencias.some((c) => c.alocacao_id === line.id);
        if (!line || !confirm(`Remover ${eq ? eq.nome : 'esta alocação'} (${line.quantidade} un.) deste evento?${hasReturn ? '\nAs conferências de retorno ligadas a ela também serão apagadas.' : ''}`)) return;
        const { error } = await db.from('alocacoes').delete().eq('id', line.id);
        if (error) { alert('Não foi possível remover: ' + error.message); return; }
        await reload();
    });

    document.addEventListener('change', (event) => {
        if (event.target.id === 'allocation-event') { selectedId = event.target.value; render(); }
        if (event.target.id === 'al-eq') updateHint();
    });
    document.addEventListener('input', (event) => { if (event.target.id === 'al-qty') updateHint(); });

    document.addEventListener('submit', async (event) => {
        if (event.target.id !== 'allocation-form') return;
        event.preventDefault();
        const form = event.target;
        const button = form.querySelector('#al-save');
        const error = form.querySelector('#al-error');
        error.hidden = true;
        button.disabled = true;
        const label = button.textContent;
        button.textContent = 'Salvando…';
        try {
            await save(form);
            document.querySelector('#allocation-modal').close();
            await reload();
        } catch (err) {
            error.textContent = err.validation ? err.message : `Não foi possível salvar: ${err.message || err}`;
            error.hidden = false;
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }, true);

    window.PalcoAllocation = { refresh: render };
})();

// Script/financeiro.js
// Módulo Financeiro (simulado): deriva receitas, despesas, fluxo de caixa, manutenção e pagamento
// da equipe a partir dos eventos, alocações, escalas e conferências que já existem no sistema.
// Os valores são fictícios e determinísticos: o mesmo evento sempre gera os mesmos números.
// Só uma coisa é gravada: quais pagamentos da equipe foram marcados como pagos (localStorage).
(() => {
    const PAGOS_KEY = 'pv_fin_pagos';

    // ---------- Tarifas simuladas (R$) ----------
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const TARIFAS = {
        diariaEquipe: { 'operador de luz': 450, 'operador de som': 480, cerimonial: 600, montagem: 320, padrao: 350 },
        diariaLocacao: { som: 120, luz: 85, estrutura: 40, energia: 260, padrao: 60 },  // por unidade/dia
        reposicao: { som: 4200, luz: 2600, estrutura: 380, energia: 9500, padrao: 900 }, // valor de reposição por unidade
        markupEquipe: 1.55,      // a equipe é faturada ao cliente com 55% sobre o cachê
        taxaProducaoBase: 1200,  // taxa fixa de produção por evento
        taxaProducaoDia: 100,    // + por dia de execução
        custoReparo: 0.18,       // reparo = 18% do valor de reposição, por unidade avariada
        operacional: 0.18,       // energia, seguro e depreciação = 18% da locação
        logisticaBase: 600, logisticaDia: 200
    };

    // Variação estável por evento (±8%), para os eventos não ficarem todos com o mesmo valor.
    const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const fator = (ev) => 0.92 + (hash(ev.id) % 17) / 100;

    // ---------- Pagamentos marcados como pagos ----------
    let pagos = null;
    function lerPagos() {
        if (pagos) return pagos;
        try { pagos = JSON.parse(localStorage.getItem(PAGOS_KEY) || '{}') || {}; } catch { pagos = {}; }
        return pagos;
    }
    function gravarPagos() { try { localStorage.setItem(PAGOS_KEY, JSON.stringify(pagos)); } catch { /* segue só em memória */ } }

    // ---------- Cálculo por evento ----------
    function tarifa(tabela, chave) { return tabela[norm(chave)] ?? tabela.padrao; }

    function diasDaFuncao(ev, funcaoNome) {
        if (norm(funcaoNome).includes('montagem')) {
            const m = parseDate(ev.data_montagem), d = parseDate(ev.data_desmontagem);
            return m && d && d >= m ? diasEntre(m, d) : 1;
        }
        const i = parseDate(ev.data_execucao_inicio), f = parseDate(ev.data_execucao_fim) || i;
        return i && f && f >= i ? diasEntre(i, f) : 1;
    }

    function calcularEvento(ev) {
        const p = periodoReserva(ev);
        const diasReserva = p ? diasEntre(p.ini, p.fim) : 1;
        const proposta = ev.status === 'proposta';
        const f = fator(ev);

        // Equipe (despesa) — um lançamento por escala
        const venc = p ? addDias(p.fim, 3) : null;
        const equipe = data.escalas.filter((s) => s.evento_id === ev.id).map((s) => {
            const prof = data.profissionais.find((x) => x.id === s.profissional_id);
            const fn = data.funcoes.find((x) => x.id === s.funcao_id);
            const dias = diasDaFuncao(ev, fn?.nome);
            const valor = Math.round(dias * tarifa(TARIFAS.diariaEquipe, fn?.nome) * f);
            return { id: s.id, prof: prof?.nome || 'Desconhecido', funcao: fn?.nome || 'Não definida', dias, valor, venc, pago: !!lerPagos()[s.id], proposta, evento: ev.nome };
        });
        const custoEquipe = equipe.reduce((s, x) => s + x.valor, 0);

        // Locação de equipamentos (receita)
        const locacao = Math.round(data.alocacoes.filter((a) => a.evento_id === ev.id).reduce((s, a) => {
            const eq = data.equipamentos.find((x) => x.id === a.equipamento_id);
            return s + a.quantidade * tarifa(TARIFAS.diariaLocacao, categoriaNome(eq?.categoria_id)) * diasReserva;
        }, 0) * f);

        const iExec = parseDate(ev.data_execucao_inicio), fExec = parseDate(ev.data_execucao_fim) || iExec;
        const diasExec = iExec && fExec && fExec >= iExec ? diasEntre(iExec, fExec) : 1;
        const servicos = Math.round(custoEquipe * TARIFAS.markupEquipe);
        const taxa = TARIFAS.taxaProducaoBase + TARIFAS.taxaProducaoDia * diasExec;
        const receita = locacao + servicos + taxa;

        // Manutenção (despesa) — avarias registradas nas conferências do evento
        const manutencao = data.conferencias.filter((c) => c.quantidade_avariada > 0).map((c) => {
            const a = data.alocacoes.find((x) => x.id === c.alocacao_id);
            if (!a || a.evento_id !== ev.id) return null;
            const eq = data.equipamentos.find((x) => x.id === a.equipamento_id);
            const unit = Math.round(tarifa(TARIFAS.reposicao, categoriaNome(eq?.categoria_id)) * TARIFAS.custoReparo);
            return { equipamento: eq?.nome || 'Desconhecido', evento: ev.nome, un: c.quantidade_avariada, unit, total: unit * c.quantidade_avariada };
        }).filter(Boolean);
        const custoManut = manutencao.reduce((s, x) => s + x.total, 0);

        const temAloc = locacao > 0;
        const logistica = temAloc ? TARIFAS.logisticaBase + TARIFAS.logisticaDia * diasReserva : 0;
        const operacional = Math.round(locacao * TARIFAS.operacional);
        const despesa = custoEquipe + custoManut + logistica + operacional;

        // Lançamentos de caixa (só existem se o evento tem datas)
        const lanc = [];
        if (p) {
            const hoje = hojeLocal();
            const add = (data_, desc, tipo, valor, realizadoAuto, pagoManual) => {
                if (valor <= 0) return;
                const realizado = !proposta && (pagoManual !== undefined ? pagoManual : data_ <= hoje) && realizadoAuto;
                lanc.push({ data: data_, desc: `${ev.nome} · ${desc}`, tipo, valor, realizado, proposta });
            };
            add(addDias(p.ini, -15), 'Sinal do contrato (50%)', 'entrada', Math.round(receita / 2), true);
            add(addDias(fExec || p.fim, 7), 'Saldo do contrato (50%)', 'entrada', receita - Math.round(receita / 2), true);
            add(p.ini, 'Logística e transporte', 'saida', logistica, true);
            add(p.fim, 'Custos operacionais', 'saida', operacional, true);
            add(addDias(p.fim, 2), 'Manutenção de avarias', 'saida', custoManut, true);
            equipe.forEach((x) => add(x.venc, `Cachê: ${x.prof}`, 'saida', x.valor, true, x.pago));
        }

        return { ev, locacao, servicos, taxa, receita, custoEquipe, custoManut, logistica, operacional, despesa,
            resultado: receita - despesa, margem: receita ? ((receita - despesa) / receita) * 100 : 0, equipe, manutencao, lanc };
    }

    // ---------- Gráfico do fluxo de caixa (SVG) ----------
    function graficoFluxo(lancs) {
        if (!lancs.length) return '<p class="fin-empty">Sem lançamentos com data para montar o fluxo de caixa.</p>';
        const pad = (n) => String(n).padStart(2, '0');
        const agrupar = (modo) => {
            const mapa = new Map();
            lancs.forEach((l) => {
                const k = modo === 'mes' ? `${l.data.getFullYear()}-${pad(l.data.getMonth() + 1)}` : toISO(inicioDaSemana(l.data));
                if (!mapa.has(k)) mapa.set(k, { k, ent: 0, sai: 0 });
                mapa.get(k)[l.tipo === 'entrada' ? 'ent' : 'sai'] += l.valor;
            });
            return [...mapa.values()].sort((a, b) => a.k.localeCompare(b.k));
        };
        let modo = 'sem';
        let b = agrupar('sem');
        if (b.length > 10) { modo = 'mes'; b = agrupar('mes'); }
        let acc = 0;
        b.forEach((x) => { acc += x.ent - x.sai; x.saldo = acc; });

        const W = 460, H = 190, top = 14, bottom = 30, left = 6, right = 6;
        const max = Math.max(1, ...b.map((x) => Math.max(x.ent, x.sai, x.saldo)));
        const min = Math.min(0, ...b.map((x) => x.saldo));
        const y = (v) => top + ((max - v) / (max - min)) * (H - top - bottom);
        const slot = (W - left - right) / b.length;
        const bw = Math.min(20, slot * 0.28);
        const cx = (i) => left + slot * i + slot / 2;
        const rotulo = (x) => modo === 'mes' ? MESES_ABREV[Number(x.k.slice(5)) - 1] : `${x.k.slice(8)}/${x.k.slice(5, 7)}`;

        const barras = b.map((x, i) => `
            <rect class="fin-in" x="${(cx(i) - bw - 1).toFixed(1)}" y="${y(x.ent).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(0) - y(x.ent)).toFixed(1)}" rx="3"><title>Entradas: ${brl(x.ent)}</title></rect>
            <rect class="fin-out" x="${(cx(i) + 1).toFixed(1)}" y="${y(x.sai).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(0) - y(x.sai)).toFixed(1)}" rx="3"><title>Saídas: ${brl(x.sai)}</title></rect>
            <text class="fin-lbl" x="${cx(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${rotulo(x)}</text>`).join('');
        const linha = b.map((x, i) => `${cx(i).toFixed(1)},${y(x.saldo).toFixed(1)}`).join(' ');
        const pontos = b.map((x, i) => `<circle class="fin-dot" cx="${cx(i).toFixed(1)}" cy="${y(x.saldo).toFixed(1)}" r="3.5"><title>Saldo acumulado: ${brl(x.saldo)}</title></circle>`).join('');

        return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluxo de caixa: entradas, saídas e saldo acumulado por ${modo === 'mes' ? 'mês' : 'semana'}">
            <line class="fin-axis" x1="${left}" x2="${W - right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
            ${barras}
            <polyline class="fin-line" points="${linha}"/>${pontos}
        </svg>
        <div class="fin-legend"><span><i class="fin-in"></i>Entradas</span><span><i class="fin-out"></i>Saídas</span><span><i class="fin-sal"></i>Saldo acumulado</span><span class="fin-per">por ${modo === 'mes' ? 'mês' : 'semana'}</span></div>`;
    }

    // ---------- Tela ----------
    let filtro = ''; // id do evento escolhido ('' = todos)
    const set = (sel, v, html) => { const el = document.querySelector(sel); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };
    const soma = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
    const cor = (v) => (v < 0 ? 'unavailable' : 'available');

    function refresh() {
        if (typeof data === 'undefined' || !data || !document.getElementById('finance')) return;

        // Seletor de evento (mantém a escolha)
        const sel = document.getElementById('fin-event');
        if (filtro && !data.eventos.some((e) => e.id === filtro)) filtro = '';
        sel.innerHTML = '<option value="">Todos os eventos</option>' + data.eventos.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
        sel.value = filtro;

        const calc = data.eventos.filter((e) => !filtro || e.id === filtro).map(calcularEvento);
        const lancs = calc.flatMap((c) => c.lanc).sort((a, b) => a.data - b.data || (a.tipo === 'entrada' ? -1 : 1));
        const hoje = hojeLocal();

        // ----- Cartões -----
        const totRec = soma(calc, (c) => c.receita), totDesp = soma(calc, (c) => c.despesa), res = totRec - totDesp;
        const entReal = soma(lancs.filter((l) => l.tipo === 'entrada' && l.realizado), (l) => l.valor);
        const saiReal = soma(lancs.filter((l) => l.tipo === 'saida' && l.realizado), (l) => l.valor);
        const aReceber = soma(lancs.filter((l) => l.tipo === 'entrada' && !l.realizado && !l.proposta), (l) => l.valor);
        const aPagar = soma(lancs.filter((l) => l.tipo === 'saida' && !l.realizado && !l.proposta), (l) => l.valor);
        const emPropostas = soma(calc.filter((c) => c.ev.status === 'proposta'), (c) => c.receita);

        set('#fin-rev', brl(totRec));
        set('#fin-rev-note', emPropostas ? `${brl(emPropostas)} ainda em proposta` : `${brl(entReal)} já recebido`);
        set('#fin-exp', brl(totDesp));
        set('#fin-exp-note', `Equipe ${brl(soma(calc, (c) => c.custoEquipe))} · manutenção ${brl(soma(calc, (c) => c.custoManut))}`);
        set('#fin-result', brl(res));
        set('#fin-result-note', `Margem de ${totRec ? ((res / totRec) * 100).toFixed(1).replace('.', ',') : '0'}%`);
        document.getElementById('fin-result-card')?.classList.toggle('warning-stat', res < 0);
        set('#fin-cash', brl(entReal - saiReal));
        set('#fin-cash-note', `A receber ${brl(aReceber)} · a pagar ${brl(aPagar)}`);

        // ----- Balanço por evento -----
        const linhasBal = calc.map((c) => `<tr>
            <td data-label="Evento">${esc(c.ev.nome)}<small class="cell-note">${c.ev.status === 'proposta' ? 'Proposta (previsto)' : 'Contrato ativo'}</small></td>
            <td data-label="Receitas">${brl(c.receita)}</td>
            <td data-label="Despesas">${brl(c.despesa)}</td>
            <td data-label="Resultado"><b class="${cor(c.resultado)}">${brl(c.resultado)}</b></td>
            <td data-label="Margem">${c.margem.toFixed(1).replace('.', ',')}%<div class="fin-bar" title="Despesas consomem ${c.receita ? Math.round((c.despesa / c.receita) * 100) : 0}% da receita"><i style="width:${c.receita ? Math.min(100, Math.round((c.despesa / c.receita) * 100)) : 0}%"></i></div></td>
        </tr>`).join('');
        const total = calc.length > 1 ? `<tr class="fin-total"><td data-label="Evento">Total</td><td data-label="Receitas">${brl(totRec)}</td><td data-label="Despesas">${brl(totDesp)}</td><td data-label="Resultado"><b class="${cor(res)}">${brl(res)}</b></td><td data-label="Margem">${totRec ? ((res / totRec) * 100).toFixed(1).replace('.', ',') : '0,0'}%</td></tr>` : '';
        set('#fin-balance-body', linhasBal + total || '<tr><td colspan="5" class="fin-empty">Nenhum evento cadastrado.</td></tr>', true);

        // ----- Fluxo de caixa -----
        set('#fin-cashflow-chart', graficoFluxo(lancs), true);
        let saldo = 0;
        const linhasFluxo = lancs.map((l) => {
            saldo += l.tipo === 'entrada' ? l.valor : -l.valor;
            const estado = l.proposta ? 'Previsto' : l.realizado ? '' : l.data < hoje ? 'Atrasado' : 'Agendado';
            return `<tr class="${l.realizado ? '' : 'fin-prev'}">
                <td data-label="Data">${fmtBR(l.data)}</td>
                <td data-label="Lançamento">${esc(l.desc)}${estado ? `<small class="cell-note">${estado}</small>` : ''}</td>
                <td data-label="Entrada">${l.tipo === 'entrada' ? `<b class="available">${brl(l.valor)}</b>` : '—'}</td>
                <td data-label="Saída">${l.tipo === 'saida' ? `<b class="unavailable">${brl(l.valor)}</b>` : '—'}</td>
                <td data-label="Saldo"><b class="${cor(saldo)}">${brl(saldo)}</b></td>
            </tr>`;
        }).join('');
        set('#fin-cashflow-body', linhasFluxo || '<tr><td colspan="5" class="fin-empty">Sem lançamentos.</td></tr>', true);

        // ----- Custos de manutenção -----
        const manut = calc.flatMap((c) => c.manutencao);
        const linhasMan = manut.map((m) => `<tr>
            <td data-label="Equipamento">${esc(m.equipamento)}<small class="cell-note">Retorno de ${esc(m.evento)}</small></td>
            <td data-label="Un.">${m.un}</td><td data-label="Custo unit.">${brl(m.unit)}</td>
            <td data-label="Total"><b class="unavailable">${brl(m.total)}</b></td>
            <td data-label="Status"><b class="pending">Em reparo</b></td></tr>`).join('');
        const totMan = manut.length ? `<tr class="fin-total"><td data-label="Equipamento">Total</td><td data-label="Un.">${soma(manut, (m) => m.un)}</td><td data-label="Custo unit.">—</td><td data-label="Total"><b class="unavailable">${brl(soma(manut, (m) => m.total))}</b></td><td data-label="Status"></td></tr>` : '';
        set('#fin-maint-body', linhasMan + totMan || '<tr><td colspan="5" class="fin-empty">Nenhuma avaria registrada nas conferências.</td></tr>', true);

        // ----- Pagamento da equipe -----
        const equipe = calc.flatMap((c) => c.equipe).sort((a, b) => (a.venc || 0) - (b.venc || 0));
        const linhasEq = equipe.map((x) => {
            const status = x.pago ? '<b class="available">Pago</b>'
                : x.proposta ? '<b class="prio-low">Previsto</b>'
                    : x.venc && x.venc < hoje ? '<b class="unavailable">Em atraso</b>' : '<b class="pending">Agendado</b>';
            const botao = x.proposta ? '' : `<button type="button" class="text-button" data-fin-pay="${esc(x.id)}">${x.pago ? 'Desfazer' : 'Marcar pago'}</button>`;
            return `<tr>
                <td data-label="Profissional">${esc(x.prof)}<small class="cell-note">${esc(x.funcao)} · ${esc(x.evento)}</small></td>
                <td data-label="Dias">${x.dias}</td><td data-label="Valor">${brl(x.valor)}</td>
                <td data-label="Vencimento">${x.venc ? fmtBR(x.venc) : '--'}</td>
                <td data-label="Status">${status}</td><td data-label="Ação">${botao}</td></tr>`;
        }).join('');
        const totEq = equipe.length ? `<tr class="fin-total"><td data-label="Profissional">Total</td><td data-label="Dias">${soma(equipe, (x) => x.dias)}</td><td data-label="Valor">${brl(soma(equipe, (x) => x.valor))}</td><td data-label="Vencimento">—</td><td data-label="Status">${brl(soma(equipe.filter((x) => !x.pago), (x) => x.valor))} em aberto</td><td></td></tr>` : '';
        set('#fin-team-body', linhasEq + totEq || '<tr><td colspan="6" class="fin-empty">Nenhum profissional escalado.</td></tr>', true);
    }

    document.addEventListener('change', (e) => {
        if (e.target.id === 'fin-event') { filtro = e.target.value; refresh(); }
    });
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fin-pay]');
        if (!b) return;
        const id = b.dataset.finPay;
        const p = lerPagos();
        if (p[id]) delete p[id]; else p[id] = true;
        gravarPagos();
        refresh();
    });

    window.PalcoFin = { refresh, calcularEvento };
})();

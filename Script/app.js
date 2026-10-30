// Script/app.js
// Camada de aplicação: carrega os dados, renderiza as telas, gráficos e gerencia os cadastros.

let data = null;

// ---------- Utilidades ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function textOr(value, fallback) { return value.trim() || fallback; }

function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

// ---------- Datas e dinheiro (usados também por script.js, quality.js e financeiro.js) ----------
const MS_DIA = 86400000;
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// "2026-10-17" -> Date local (evita o deslocamento de fuso do new Date('YYYY-MM-DD'))
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function diasEntre(a, b) { return Math.max(1, Math.round((b - a) / MS_DIA) + 1); } // inclusivo
function hojeLocal() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function fmtBR(d) { return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '--'; }
function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function inicioDaSemana(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; } // segunda-feira

// Período em que o evento ocupa recursos: da montagem até a desmontagem.
function periodoReserva(ev) {
  const ini = parseDate(ev.data_montagem || ev.data_execucao_inicio);
  const fim = parseDate(ev.data_desmontagem || ev.data_execucao_fim || ev.data_execucao_inicio);
  if (!ini || !fim) return null;
  return { ini, fim: fim < ini ? ini : fim };
}

// ---------- Helpers de exibição ----------
function categoriaNome(id) {
  const c = data?.categorias.find(x => x.id === id);
  return c ? c.nome : 'Sem categoria';
}

function habilidadesDoProfissional(profId) {
  const ids = data.profHabilidades.filter(x => x.profissional_id === profId).map(x => x.habilidade_id);
  return data.habilidades.filter(h => ids.includes(h.id)).map(h => h.nome);
}

const DIAS_OPCOES = [
  { label: 'Todos os dias', dias: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Segunda a sexta', dias: [1, 2, 3, 4, 5] },
  { label: 'Sexta a domingo', dias: [5, 6, 7] },
  { label: 'Quarta a sábado', dias: [3, 4, 5, 6] },
  { label: 'Sábado e domingo', dias: [6, 7] }
];

function arraysIguais(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function diasParaTexto(dias) {
  if (!dias || !dias.length) return 'Indisponível';
  const opcao = DIAS_OPCOES.find(o => arraysIguais(o.dias, dias));
  return opcao ? opcao.label : dias.join(', ');
}

// ---------- Regras de negócio compartilhadas ----------
// Unidades do equipamento que estão em manutenção (avarias registradas nas conferências de retorno).
function emManutencao(equipId, d = data) {
  const ids = new Set(d.alocacoes.filter(a => a.equipamento_id === equipId).map(a => a.id));
  return d.conferencias.filter(c => ids.has(c.alocacao_id)).reduce((s, c) => s + (c.quantidade_avariada || 0), 0);
}

// Período em que o item fica comprometido com o evento (montagem → desmontagem).
// Se o equipamento exige folga, o dia seguinte à desmontagem também conta.
function periodoDoItem(ev, eq) {
  const p = periodoReserva(ev);
  if (!p) return null;
  return { ini: p.ini, fim: eq?.exige_folga ? addDias(p.fim, 1) : p.fim };
}

// Estoque utilizável no período: unidades em manutenção só reduzem períodos que ainda não passaram.
function capacidadeNoPeriodo(eq, periodo, d = data) {
  const manut = periodo.fim >= hojeLocal() ? emManutencao(eq.id, d) : 0;
  return Math.max(0, eq.quantidade - manut);
}

const periodosSeCruzam = (a, b) => a.ini <= b.fim && b.ini <= a.fim;

// Conflito de estoque: soma das alocações do mesmo equipamento em períodos que se cruzam
// (já com a folga) passa da capacidade. Retorna Map(alocacao.id -> motivo).
function calcularConflitos(d = data) {
  const conflitos = new Map();
  if (!d) return conflitos;
  d.alocacoes.forEach(a => {
    const eq = d.equipamentos.find(e => e.id === a.equipamento_id);
    const ev = d.eventos.find(e => e.id === a.evento_id);
    const p = eq && ev && periodoDoItem(ev, eq);
    if (!p) return;
    let total = 0;
    d.alocacoes.forEach(b => {
      if (b.equipamento_id !== a.equipamento_id) return;
      const evb = d.eventos.find(e => e.id === b.evento_id);
      const pb = evb && periodoDoItem(evb, eq);
      if (pb && periodosSeCruzam(p, pb)) total += b.quantidade;
    });
    const cap = capacidadeNoPeriodo(eq, p, d);
    if (total > cap) {
      const extra = [eq.exige_folga ? 'com 1 dia de folga' : '', cap < eq.quantidade ? `${eq.quantidade - cap} em manutenção` : ''].filter(Boolean).join(', ');
      conflitos.set(a.id, `${total} un. reservadas no período${extra ? ` (${extra})` : ''}, mas só ${cap} estão disponíveis`);
    }
  });
  return conflitos;
}

// Valida UM pedido de alocação ANTES de gravar (usado pelo modal e pela prévia).
function validarAlocacao(eventoId, equipId, qtd, d = data) {
  const eq = d.equipamentos.find(e => e.id === equipId);
  const ev = d.eventos.find(e => e.id === eventoId);
  const falha = (motivo) => ({ ok: false, semPeriodo: true, motivo, capacidade: 0, disponivel: 0 });
  if (!eq || !ev) return falha('Evento ou equipamento não encontrado.');
  const p = periodoDoItem(ev, eq);
  if (!p) return falha('Defina as datas de montagem e desmontagem do evento antes de alocar equipamentos.');

  const capacidade = capacidadeNoPeriodo(eq, p, d);
  const reservado = d.alocacoes.filter(a => a.equipamento_id === equipId).reduce((s, a) => {
    if (a.evento_id === eventoId) return s + a.quantidade; // o que este evento já reservou
    const evb = d.eventos.find(e => e.id === a.evento_id);
    const pb = evb && periodoDoItem(evb, eq);
    return pb && periodosSeCruzam(p, pb) ? s + a.quantidade : s;
  }, 0);
  const disponivel = Math.max(0, capacidade - reservado);
  const ok = qtd <= disponivel;
  return {
    ok, semPeriodo: false, capacidade, disponivel, periodo: p,
    motivo: ok ? '' : `Pedido de ${qtd} un., mas só ${disponivel} de ${capacidade} estão livres entre ${fmtBR(p.ini)} e ${fmtBR(p.fim)}${eq.exige_folga ? ' (inclui 1 dia de folga)' : ''}.`
  };
}

// Conferência de uma alocação: somas das conferências já registradas.
function resumoRetorno(a, d = data) {
  const cs = d.conferencias.filter(c => c.alocacao_id === a.id);
  const retornada = cs.reduce((s, c) => s + (c.quantidade_retornada || 0), 0);
  const avariada = cs.reduce((s, c) => s + (c.quantidade_avariada || 0), 0);
  return { retornada, avariada, conferido: retornada + avariada, pendente: Math.max(0, a.quantidade - retornada - avariada) };
}

// Quantidade de uma alocação que ainda não foi conferida no retorno.
function pendenciaRetorno(a) { return resumoRetorno(a).pendente; }

// Resumo de uma lista de alocações (um evento ou todos). estado: sem_itens | nao_iniciado | parcial | completo
function resumoRetornoLista(itens, d = data) {
  const r = itens.reduce((acc, a) => {
    const x = resumoRetorno(a, d);
    acc.enviadas += a.quantidade; acc.conferidas += x.conferido; acc.avariadas += x.avariada; acc.pendentes += x.pendente;
    if (x.pendente === 0) acc.itensOk += 1;
    return acc;
  }, { enviadas: 0, conferidas: 0, avariadas: 0, pendentes: 0, itensOk: 0 });
  const estado = !itens.length ? 'sem_itens' : r.pendentes === 0 ? 'completo' : r.conferidas > 0 ? 'parcial' : 'nao_iniciado';
  return { ...r, itens: itens.length, estado };
}
function resumoRetornoEvento(eventoId, d = data) {
  return resumoRetornoLista(d.alocacoes.filter(a => a.evento_id === eventoId), d);
}

// Mantém eventos.status coerente com as conferências (usa só valores já permitidos pelo banco):
//   todos os itens voltaram -> 'encerrado' | voltou só parte -> 'pendente_retorno'
//   nada conferido (ex.: conferência desfeita) -> sai de 'encerrado'/'pendente_retorno'
// É idempotente: só grava quando o status realmente muda.
async function sincronizarStatusRetorno() {
  let mudou = false;
  for (const ev of data.eventos) {
    const r = resumoRetornoEvento(ev.id);
    if (!r.itens) continue;
    let alvo = ev.status;
    if (r.estado === 'completo') alvo = 'encerrado';
    else if (r.estado === 'parcial') alvo = 'pendente_retorno';
    else if (['pendente_retorno', 'encerrado'].includes(ev.status)) alvo = data.escalas.some(s => s.evento_id === ev.id) ? 'escalado' : 'contratado';
    if (alvo === ev.status) continue;
    const { error } = await db.from('eventos').update({ status: alvo }).eq('id', ev.id);
    if (error) { console.warn('Não foi possível atualizar o status do evento:', error.message); continue; }
    mudou = true;
  }
  if (mudou) data = await loadAllData();
}

// ---------- Preenchimento de Selects Dinâmicos ----------
let filtroAlocEvento = ''; // evento escolhido no filtro da tela de Alocação

function populateSelects() {
  const opcoes = (lista, rotulo) => lista.map(x => `<option value="${x.id}">${esc(rotulo(x))}</option>`).join('');

  const catSelect = document.querySelector('#eq-category');
  if (catSelect) catSelect.innerHTML = opcoes(data.categorias, c => c.nome);

  const allocEv = document.querySelector('#alloc-event');
  if (allocEv) allocEv.innerHTML = opcoes(data.eventos, e => e.nome);
  const allocEq = document.querySelector('#alloc-equip');
  if (allocEq) allocEq.innerHTML = opcoes(data.equipamentos, e => e.nome);

  const schedEv = document.querySelector('#sched-event');
  if (schedEv) schedEv.innerHTML = opcoes(data.eventos, e => e.nome);
  const schedFunc = document.querySelector('#sched-func');
  if (schedFunc) schedFunc.innerHTML = opcoes(data.funcoes, f => f.nome);
  const schedProf = document.querySelector('#sched-prof');
  if (schedProf) schedProf.innerHTML = opcoes(data.profissionais, p => p.nome);

  // Só aparecem alocações com devolução ainda pendente
  const retAlloc = document.querySelector('#return-alocacao');
  if (retAlloc) {
    const pendentes = data.alocacoes.filter(a => pendenciaRetorno(a) > 0);
    retAlloc.innerHTML = pendentes.length
      ? pendentes.map(a => {
        const eq = data.equipamentos.find(e => e.id === a.equipamento_id);
        const ev = data.eventos.find(e => e.id === a.evento_id);
        return `<option value="${a.id}">${esc(ev?.nome)} - ${esc(eq?.nome)} (${pendenciaRetorno(a)} un pendentes)</option>`;
      }).join('')
      : '<option value="">Nenhuma alocação pendente</option>';
  }

  // Filtro de evento na tela de Alocação (mantém a escolha atual)
  const filtro = document.querySelector('#allocation-event');
  if (filtro) {
    if (filtroAlocEvento && !data.eventos.some(e => e.id === filtroAlocEvento)) filtroAlocEvento = '';
    filtro.innerHTML = '<option value="">Todos os eventos</option>' + opcoes(data.eventos, e => e.nome);
    filtro.value = filtroAlocEvento;
  }
}

// ---------- Gráficos ----------
// Eventos por mês nos últimos n meses (o último é o mês atual).
function eventosPorMes(n = 6) {
  const hoje = new Date();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push({ ano: d.getFullYear(), mes: d.getMonth(), label: MESES_ABREV[d.getMonth()], total: 0 });
  }
  data.eventos.forEach(ev => {
    const d = parseDate(ev.data_execucao_inicio || ev.data_montagem);
    const m = d && meses.find(x => x.ano === d.getFullYear() && x.mes === d.getMonth());
    if (m) m.total += 1;
  });
  return meses;
}

// Curva suave (Catmull-Rom convertida em Bézier). Os pontos de controle ficam dentro da faixa
// vertical de cada trecho, então a linha nunca "afunda" abaixo de zero nem passa do máximo.
function caminhoSuave(pts) {
  const f = v => v.toFixed(1);
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
    const clampY = v => Math.min(hi, Math.max(lo, v));
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

function renderSparkline(meses) {
  const line = document.querySelector('#spark-line');
  const area = document.querySelector('#spark-area');
  const dot = document.querySelector('#spark-dot');
  const labels = document.querySelector('#spark-months');
  if (!line || !area || !dot) return;

  const max = Math.max(1, ...meses.map(m => m.total));
  const pts = meses.map((m, i) => ({ x: (i * 200) / Math.max(1, meses.length - 1), y: 56 - (m.total / max) * 48 }));
  const caminho = caminhoSuave(pts);
  line.setAttribute('d', caminho);
  area.setAttribute('d', `${caminho}L200 64L0 64Z`);
  const ultimo = pts[pts.length - 1];
  dot.setAttribute('cx', ultimo.x);
  dot.setAttribute('cy', ultimo.y);
  if (labels) labels.innerHTML = meses.map(m => `<span title="${m.total} evento(s)">${m.label}</span>`).join('');
}

// Uso do acervo em unidades: alocado (ainda fora do estoque), em manutenção e livre.
// Unidades já devolvidas intactas voltam a contar como livres.
function calcularUsoAcervo() {
  let total = 0, alocado = 0, manut = 0;
  data.equipamentos.forEach(eq => {
    const m = Math.min(emManutencao(eq.id), eq.quantidade);
    const reservado = data.alocacoes.filter(a => a.equipamento_id === eq.id).reduce((s, a) => s + pendenciaRetorno(a), 0);
    total += eq.quantidade;
    manut += m;
    alocado += Math.min(reservado, eq.quantidade - m); // nunca conta acima do estoque
  });
  return { total, alocado, manut, livre: Math.max(0, total - alocado - manut) };
}

// Anel de 3 fatias. pathLength=100: o tamanho do traço é a própria porcentagem.
function renderDonut(uso) {
  const { total, alocado, manut } = uso;
  const pct = v => (total > 0 ? (v / total) * 100 : 0);
  const u = pct(alocado), m = pct(manut), l = Math.max(0, 100 - u - m);
  const fatia = (sel, tam, inicio) => {
    const c = document.querySelector(sel);
    if (!c) return;
    c.setAttribute('stroke-dasharray', `${tam.toFixed(2)} ${(100 - tam).toFixed(2)}`);
    c.setAttribute('stroke-dashoffset', String(-Math.round(inicio * 100) / 100));
  };
  fatia('#dash-donut-used', u, 0);
  fatia('#dash-donut-maint', m, u);
  fatia('#dash-donut-free', l, u + m);
}

function iniciais(nome) {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function alertaHtml(tipo, titulo, texto) {
  return `<div class="alert alert-${tipo}"><b>${esc(titulo)}</b><p>${esc(texto)}</p></div>`;
}

// ---------- Dashboard (Visão Geral) ----------
function renderDashboard() {
  const hoje = hojeLocal();
  const conflitos = calcularConflitos();

  // 1. Eventos no mês + sparkline
  const meses = eventosPorMes(6);
  document.querySelector('#dash-events').textContent = meses[meses.length - 1].total;
  const seg = inicioDaSemana(hoje), dom = addDias(seg, 6);
  const naSemana = data.eventos.filter(ev => {
    const i = parseDate(ev.data_execucao_inicio), f = parseDate(ev.data_execucao_fim) || i;
    return i && i <= dom && f >= seg;
  }).length;
  const nota = document.querySelector('#dash-events-note');
  if (nota) nota.textContent = `${naSemana} nesta semana`;
  renderSparkline(meses);

  // 2. Equipamentos alocados (anel): calculado a partir de equipamentos + alocacoes + conferencias
  const uso = calcularUsoAcervo();
  const pctEq = uso.total > 0 ? Math.round((uso.alocado / uso.total) * 100) : 0;
  document.querySelector('#dash-equip-pct').textContent = pctEq + '%';
  document.querySelector('#dash-equip-frac').innerHTML = `${uso.alocado} <em>/ ${uso.total}</em>`;
  renderDonut(uso);

  // 3. Equipe escalada + avatares
  const totalProf = data.profissionais.length;
  const escalados = data.profissionais.filter(p => data.escalas.some(e => e.profissional_id === p.id));
  document.querySelector('#dash-team-frac').innerHTML = `${escalados.length} <em>/ ${totalProf}</em>`;
  const avatares = document.querySelector('#dash-team-avatars');
  if (avatares) {
    const visiveis = escalados.length > 4 ? escalados.slice(0, 3) : escalados;
    avatares.innerHTML = visiveis.map(p => `<i title="${esc(p.nome)}">${esc(iniciais(p.nome))}</i>`).join('')
      + (escalados.length > 4 ? `<i>+${escalados.length - 3}</i>` : '');
  }

  // 4. Conflitos detectados: equipamentos com estoque excedido no período + eventos bloqueados
  const equipEmConflito = new Set([...conflitos.keys()].map(id => data.alocacoes.find(a => a.id === id).equipamento_id));
  const bloqueados = data.eventos.filter(e => e.status === 'bloqueado').length;
  document.querySelector('#dash-conflicts').textContent = equipEmConflito.size + bloqueados;

  // 5. Próximos eventos: os que ainda vão acontecer (mais próximos primeiro); depois os mais recentes
  const dataEv = ev => parseDate(ev.data_execucao_inicio) || parseDate(ev.data_montagem);
  const futuros = data.eventos.filter(ev => { const d = dataEv(ev); return d && (parseDate(ev.data_execucao_fim) || d) >= hoje; })
    .sort((a, b) => dataEv(a) - dataEv(b));
  const passados = data.eventos.filter(ev => !futuros.includes(ev)).sort((a, b) => (dataEv(b) || 0) - (dataEv(a) || 0));
  const lista = [...futuros, ...passados].slice(0, 3);

  const overviewList = document.querySelector('#overview-events');
  if (overviewList) {
    const linhas = lista.map(ev => {
      const temConflito = data.alocacoes.some(a => a.evento_id === ev.id && conflitos.has(a.id));
      const badge = temConflito || ev.status === 'bloqueado' ? '<span class="tag conflict">Atenção</span>'
        : ev.status === 'proposta' ? '<span class="tag planned">Proposta</span>'
          : '<span class="tag confirmed">Confirmado</span>';
      const itens = data.alocacoes.filter(a => a.evento_id === ev.id).reduce((s, a) => s + a.quantidade, 0);
      const equipe = data.escalas.filter(s => s.evento_id === ev.id).length;
      return `<div class="event-row">
        <div class="ev-main"><strong>${esc(ev.nome)}</strong><small>Montagem · ${esc(fmtBR(parseDate(ev.data_montagem)))}</small></div>
        <span class="date ev-date">${esc(fmtBR(parseDate(ev.data_execucao_inicio)))}</span>
        <span class="ev-items">${itens} itens</span>
        <span class="ev-stat">${badge}</span>
        <span class="ev-crew">${equipe ? plural(equipe, 'pessoa', 'pessoas') : '--'}</span>
      </div>`;
    }).join('');
    overviewList.innerHTML = linhas || '<div style="padding: 20px; color: var(--mu);">Nenhum evento cadastrado.</div>';
  }

  // 6. Validações pendentes
  const validacoes = [];
  const porEquip = new Map();
  conflitos.forEach((motivo, alocId) => {
    const a = data.alocacoes.find(x => x.id === alocId);
    if (!porEquip.has(a.equipamento_id)) porEquip.set(a.equipamento_id, motivo);
  });
  porEquip.forEach((motivo, eqId) => {
    const eq = data.equipamentos.find(e => e.id === eqId);
    validacoes.push(alertaHtml('critical', `${eq?.nome || 'Equipamento'}: estoque excedido`, motivo));
  });
  data.eventos.filter(ev => ev.status !== 'encerrado').forEach(ev => {
    if (!data.alocacoes.some(a => a.evento_id === ev.id)) validacoes.push(alertaHtml('warning', ev.nome, 'Evento sem equipamentos alocados.'));
    else if (['escalado', 'em_execucao'].includes(ev.status) && !data.escalas.some(s => s.evento_id === ev.id)) validacoes.push(alertaHtml('warning', ev.nome, 'Evento sem equipe escalada.'));
  });
  const boxVal = document.querySelector('#overview-validations');
  if (boxVal) boxVal.innerHTML = validacoes.slice(0, 4).join('') || alertaHtml('success', 'Tudo em ordem', 'Nenhuma validação pendente.');

  // 7. Equipamentos em manutenção (avarias registradas na conferência)
  const manut = data.conferencias.filter(c => c.quantidade_avariada > 0).map(c => {
    const a = data.alocacoes.find(x => x.id === c.alocacao_id);
    const eq = a && data.equipamentos.find(e => e.id === a.equipamento_id);
    const ev = a && data.eventos.find(e => e.id === a.evento_id);
    return alertaHtml('warning', eq?.nome || 'Equipamento', `${plural(c.quantidade_avariada, 'unidade avariada', 'unidades avariadas')} · retorno do evento ${ev?.nome || '--'}`);
  });
  const boxMan = document.querySelector('#overview-maintenance');
  if (boxMan) boxMan.innerHTML = manut.slice(0, 4).join('') || alertaHtml('success', 'Sem avarias', 'Nenhum equipamento em manutenção.');

  // 8. Devoluções em aberto
  const abertas = data.alocacoes.filter(a => pendenciaRetorno(a) > 0).map(a => {
    const eq = data.equipamentos.find(e => e.id === a.equipamento_id);
    const ev = data.eventos.find(e => e.id === a.evento_id);
    return alertaHtml('warning', eq?.nome || 'Equipamento', `${pendenciaRetorno(a)} de ${a.quantidade} un. sem conferência · ${ev?.nome || '--'}`);
  });
  const boxRet = document.querySelector('#overview-returns');
  if (boxRet) boxRet.innerHTML = abertas.slice(0, 4).join('') || alertaHtml('success', 'Tudo conferido', 'Nenhuma devolução em aberto.');
}

// ---------- Exclusão ----------
const ICONE_LIXEIRA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

function btnExcluir(tabela, id, rotulo) {
  return `<button type="button" class="del-btn" data-del="${tabela}:${esc(id)}" data-del-label="${esc(rotulo)}" title="Excluir" aria-label="Excluir ${esc(rotulo)}">${ICONE_LIXEIRA}</button>`;
}

// Texto de aviso com o que será apagado junto (espelha o ON DELETE CASCADE do banco).
function descreverImpacto(tabela, id) {
  const conta = (lista, fn) => lista.filter(fn).length;
  if (tabela === 'eventos') {
    const a = conta(data.alocacoes, x => x.evento_id === id), s = conta(data.escalas, x => x.evento_id === id);
    return a || s ? `Também serão removidas ${plural(a, 'alocação', 'alocações')} e ${plural(s, 'escala', 'escalas')} deste evento, com as conferências ligadas a elas.` : '';
  }
  if (tabela === 'equipamentos') {
    const a = conta(data.alocacoes, x => x.equipamento_id === id);
    return a ? `Também serão removidas ${plural(a, 'alocação', 'alocações')} deste equipamento, com as conferências ligadas a elas.` : '';
  }
  if (tabela === 'profissionais') {
    const s = conta(data.escalas, x => x.profissional_id === id);
    return s ? `Também serão removidas ${plural(s, 'escala', 'escalas')} deste profissional.` : '';
  }
  if (tabela === 'alocacoes') {
    const c = conta(data.conferencias, x => x.alocacao_id === id);
    return c ? `Também ${c === 1 ? 'será removida 1 conferência' : `serão removidas ${c} conferências`} desta alocação.` : '';
  }
  return '';
}

document.addEventListener('click', async (event) => {
  const botao = event.target.closest('[data-del]');
  if (!botao || botao.disabled) return;
  const sep = botao.dataset.del.indexOf(':');
  const tabela = botao.dataset.del.slice(0, sep);
  const id = botao.dataset.del.slice(sep + 1);
  const impacto = descreverImpacto(tabela, id);
  if (!confirm(`Excluir "${botao.dataset.delLabel}"?${impacto ? '\n\n' + impacto : ''}\n\nEsta ação não pode ser desfeita.`)) return;

  botao.disabled = true;
  const { error } = await db.from(tabela).delete().eq('id', id);
  if (error) {
    botao.disabled = false;
    alert('Não foi possível excluir: ' + error.message);
    return;
  }
  botao.closest('tr')?.remove();   // some da tabela na hora...
  await refreshData();
  renderAll();                     // ...e gráficos, contadores e demais telas são recalculados
});

// ---------- Renderização Dinâmica das Tabelas ----------
function renderEquipamentos() {
  const body = document.querySelector('#equipment-body');
  if (!body) return;
  const linhas = data.equipamentos.map(eq => {
    const folga = eq.exige_folga ? 'Sim' : 'Não';
    return `<tr>
      <td data-label="Equipamento">${esc(eq.nome)}</td>
      <td data-label="Categoria"><span class="pill">${esc(categoriaNome(eq.categoria_id))}</span></td>
      <td data-label="Quantidade">${eq.quantidade}</td>
      <td data-label="Dia de folga">${folga}</td>
      <td data-label="Disponível"><b class="available">${eq.quantidade - emManutencao(eq.id)} unidades</b>${emManutencao(eq.id) ? `<small class="cell-note">${emManutencao(eq.id)} em manutenção</small>` : ''}</td>
      <td data-label="Ações">${btnExcluir('equipamentos', eq.id, eq.nome)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas + '<tr class="empty-equipment" hidden><td colspan="6">Nenhum equipamento encontrado.</td></tr>';
  document.querySelector('#equipment-results').textContent = `Exibindo ${data.equipamentos.length} equipamentos`;
  window.PalcoUI?.refreshSearch?.();
}

function renderProfissionais() {
  const body = document.querySelector('#people-body');
  if (!body) return;
  const linhas = data.profissionais.map(p => {
    const skills = habilidadesDoProfissional(p.id);
    const pills = skills.length
      ? skills.map(s => `<span class="pill">${esc(s)}</span>`).join(' ')
      : '<span class="pill">sem habilitação</span>';
    return `<tr>
      <td data-label="Profissional">${esc(p.nome)}</td>
      <td data-label="Habilitações">${pills}</td>
      <td data-label="Disponibilidade">${esc(diasParaTexto(p.dias_disponiveis))}</td>
      <td data-label="Próxima escala"><b class="available">Livre</b></td>
      <td data-label="Ações">${btnExcluir('profissionais', p.id, p.nome)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas + '<tr class="empty-people" hidden><td colspan="5">Nenhum profissional encontrado.</td></tr>';
  document.querySelector('#people-results').textContent = `Exibindo ${data.profissionais.length} profissionais`;
  window.PalcoUI?.refreshSearch?.();
}

function renderEventos() {
  const body = document.querySelector('#event-body');
  if (!body) return;
  const mapStatus = {
    'proposta': '<span class="tag planned">Proposta</span>',
    'contratado': '<span class="tag confirmed">Contratado</span>',
    'escalado': '<span class="tag confirmed">Escalado</span>',
    'em_execucao': '<span class="tag confirmed">Em execução</span>',
    'encerrado': '<span class="tag">Encerrado</span>',
    'bloqueado': '<span class="tag conflict">Bloqueado</span>',
    'pendente_retorno': '<span class="tag conflict">Pendente retorno</span>'
  };
  const linhas = data.eventos.map(ev => {
    const badge = mapStatus[ev.status] || `<span class="tag">${esc(ev.status)}</span>`;
    const filterStatus = ev.status === 'em_execucao' ? 'execucao' : ev.status;
    const qtdItens = data.alocacoes.filter(a => a.evento_id === ev.id).reduce((acc, a) => acc + a.quantidade, 0);

    return `<tr data-status="${filterStatus}">
      <td data-label="Evento"><div class="ev-main"><strong>${esc(ev.nome)}</strong><small>Montagem · ${esc(ev.data_montagem || 'S/D')}</small></div></td>
      <td data-label="Montagem">${esc(ev.data_montagem || '--')}</td>
      <td data-label="Execução">${esc(ev.data_execucao_inicio || '--')} a ${esc(ev.data_execucao_fim || '--')}</td>
      <td data-label="Desmontagem">${esc(ev.data_desmontagem || '--')}</td>
      <td data-label="Itens">${qtdItens} itens</td>
      <td data-label="Status">${badge}</td>
      <td data-label="Ações"><button class="text-button" data-go="map">Ver mapa</button> ${btnExcluir('eventos', ev.id, ev.nome)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas + '<tr class="empty-events" hidden><td colspan="7">Não há eventos nesta etapa.</td></tr>';

  window.PalcoUI?.refreshEvents?.(); // recalcula os contadores das abas e reaplica o filtro ativo
}

function renderAlocacoes() {
  const body = document.querySelector('#allocation-body');
  if (!body) return;
  const conflitos = calcularConflitos();
  const lista = data.alocacoes.filter(a => !filtroAlocEvento || a.evento_id === filtroAlocEvento);

  const linhas = lista.map(a => {
    const eq = data.equipamentos.find(e => e.id === a.equipamento_id);
    const ev = data.eventos.find(e => e.id === a.evento_id);
    const motivo = conflitos.get(a.id);
    const p = ev && eq && periodoDoItem(ev, eq);
    const validacao = motivo
      ? `<b class="unavailable">Conflito / Bloqueado</b><small class="cell-note">${esc(motivo)}</small>`
      : '<b class="available">Alocado</b>';
    const periodo = p
      ? `${esc(fmtBR(p.ini))} a ${esc(fmtBR(p.fim))}${eq.exige_folga ? '<small class="cell-note">inclui 1 dia de folga</small>' : ''}`
      : '--';
    return `<tr>
      <td data-label="Equipamento">${esc(eq?.nome || 'Desconhecido')} <small class="cell-note">Alocado para: ${esc(ev?.nome || '')}</small></td>
      <td data-label="Quantidade">${a.quantidade}</td>
      <td data-label="Em estoque">${eq?.quantidade || 0} unidades</td>
      <td data-label="Período reservado">${periodo}</td>
      <td data-label="Folga">${eq?.exige_folga ? 'Sim' : 'Não'}</td>
      <td data-label="Validação">${validacao}</td>
      <td data-label="Ações">${btnExcluir('alocacoes', a.id, `${eq?.nome || 'alocação'} em ${ev?.nome || 'evento'}`)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas || '<tr><td colspan="7" style="text-align:center;color:var(--mu);padding: 30px;">Nenhuma alocação registrada.</td></tr>';

  // Cartões de resumo e caixa de validação
  const bloqueados = lista.filter(a => conflitos.has(a.id)).length;
  const set = (sel, v) => { const el = document.querySelector(sel); if (el) el.textContent = v; };
  set('#alloc-stat-req', lista.length);
  set('#alloc-stat-ok', lista.length - bloqueados);
  set('#alloc-stat-block', bloqueados);

  const evSel = data.eventos.find(e => e.id === filtroAlocEvento);
  const per = evSel && periodoReserva(evSel);
  set('#allocation-period', per ? `Reserva: ${fmtBR(per.ini)} a ${fmtBR(per.fim)}` : '--');
  const caixa = document.querySelector('#allocation-validation');
  if (caixa) {
    caixa.innerHTML = !lista.length ? '<b>Nenhuma alocação</b><span>Não há equipamentos alocados para exibir.</span>'
      : bloqueados ? `<b>${plural(bloqueados, 'item bloqueado', 'itens bloqueados')}</b><span>Estoque insuficiente em períodos que se sobrepõem.</span>`
        : '<b>Alocação válida</b><span>Todos os itens têm estoque no período reservado.</span>';
  }

  // Botão "Confirmar alocação": só habilita com um evento escolhido, itens alocados e nenhum bloqueio
  const btn = document.querySelector('#confirm-allocation');
  if (btn) {
    const motivoBloqueio = !filtroAlocEvento ? 'Selecione um evento para confirmar.'
      : !lista.length ? 'Este evento não tem itens alocados.'
        : bloqueados ? 'Resolva os itens em conflito antes de confirmar.' : '';
    btn.disabled = !!motivoBloqueio;
    btn.title = motivoBloqueio;
  }
  atualizarPreviaAlocacao();
}

function renderEscalas() {
  const body = document.querySelector('#schedule-body');
  if (!body) return;
  const linhas = data.escalas.map(sc => {
    const prof = data.profissionais.find(p => p.id === sc.profissional_id);
    const ev = data.eventos.find(e => e.id === sc.evento_id);
    const fn = data.funcoes.find(f => f.id === sc.funcao_id);
    const skills = prof ? habilidadesDoProfissional(prof.id).join(', ') : '';
    return `<tr>
      <td data-label="Função">${esc(fn?.nome || 'Não definida')} <small class="cell-note">Evento: ${esc(ev?.nome || '')}</small></td>
      <td data-label="Profissional">${esc(prof?.nome || 'Desconhecido')}</td>
      <td data-label="Habilitações">${esc(skills)}</td>
      <td data-label="Disponibilidade">${esc(diasParaTexto(prof?.dias_disponiveis))}</td>
      <td data-label="Validação"><b class="available">Escala Válida</b></td>
      <td data-label="Ações">${btnExcluir('escalas', sc.id, `${prof?.nome || 'profissional'} em ${ev?.nome || 'evento'}`)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas || '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding: 30px;">Nenhum profissional escalado.</td></tr>';
}

let filtroRetEvento = ''; // evento escolhido no filtro da tela Saída e Retorno

const ROTULO_RETORNO = {
  sem_itens: 'Sem equipamentos alocados',
  nao_iniciado: 'Devolução não iniciada',
  parcial: 'Devolução parcial — há pendências',
  completo: 'Devolução completa — todos os itens voltaram'
};

function renderRetornos() {
  const body = document.querySelector('#return-body');
  if (!body) return;

  // Filtro de evento (mantém a escolha atual)
  const sel = document.querySelector('#return-event');
  if (sel) {
    if (filtroRetEvento && !data.eventos.some(e => e.id === filtroRetEvento)) filtroRetEvento = '';
    sel.innerHTML = '<option value="">Todos os eventos</option>' + data.eventos.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
    sel.value = filtroRetEvento;
  }

  // Uma linha por alocação, somando todas as conferências (retornos parciais incluídos)
  const lista = data.alocacoes.filter(a => !filtroRetEvento || a.evento_id === filtroRetEvento);
  const linhas = lista.map(a => {
    const eq = data.equipamentos.find(e => e.id === a.equipamento_id);
    const ev = data.eventos.find(e => e.id === a.evento_id);
    const r = resumoRetorno(a);
    const condicao = r.avariada > 0 ? `<b class="unavailable">${r.avariada} em manutenção</b>` : (r.conferido ? 'Sem avaria' : '--');
    const status = r.pendente === 0 ? '<b class="available">Conferido</b>'
      : r.conferido ? `<b class="unavailable">Parcial</b><small class="cell-note">faltam ${r.pendente} un.</small>`
        : '<b class="unavailable">Pendente</b>';
    const acoes = [
      r.pendente > 0 ? `<button type="button" class="text-button" data-return-alloc="${esc(a.id)}">Conferir</button>` : '',
      r.conferido > 0 ? `<button type="button" class="text-button" data-undo-return="${esc(a.id)}">Desfazer</button>` : ''
    ].join(' ');
    return `<tr>
      <td data-label="Item">${esc(eq?.nome || 'Desconhecido')} <small class="cell-note">De: ${esc(ev?.nome || '')}</small></td>
      <td data-label="Qtd. enviada">${a.quantidade}</td>
      <td data-label="Qtd. retornada">${r.retornada}</td>
      <td data-label="Condição">${condicao}</td>
      <td data-label="Status">${status}</td>
      <td data-label="Ações">${acoes}</td>
    </tr>`;
  }).join('');
  body.innerHTML = linhas || '<tr><td colspan="6" style="text-align:center;color:var(--mu);padding: 30px;">Nenhuma alocação para conferir.</td></tr>';

  // Cartão de status geral + barra de progresso (em unidades)
  const resumo = resumoRetornoLista(lista);
  const evSel = data.eventos.find(e => e.id === filtroRetEvento);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('return-label', evSel ? ROTULO_RETORNO[resumo.estado] : `Todos os eventos · ${ROTULO_RETORNO[resumo.estado]}`);
  set('return-title', evSel ? evSel.nome : 'Conferência de retorno');
  set('return-sub', [
    evSel ? `Desmontagem: ${fmtBR(parseDate(evSel.data_desmontagem))}` : '',
    `${resumo.avariadas} em manutenção`,
    `${resumo.pendentes} un. pendentes`
  ].filter(Boolean).join(' · '));
  set('return-progress-text', `${resumo.conferidas} de ${resumo.enviadas}`);
  const barra = document.getElementById('return-progress-bar');
  if (barra) barra.style.width = `${resumo.enviadas ? Math.round((resumo.conferidas / resumo.enviadas) * 100) : 0}%`;

  preencherRetorno();
}

document.querySelector('#return-event')?.addEventListener('change', (e) => {
  filtroRetEvento = e.target.value;
  renderRetornos();
});

// Modal de retorno: mostra o que falta e já sugere "tudo voltou intacto"
function preencherRetorno() {
  const sel = document.querySelector('#return-alocacao');
  const nota = document.querySelector('#return-pending');
  const ok = document.querySelector('#return-amount');
  const av = document.querySelector('#return-damaged');
  const a = data?.alocacoes.find(x => x.id === sel?.value);
  if (!a) { if (nota) nota.textContent = 'Nenhuma alocação pendente.'; return; }
  const pend = pendenciaRetorno(a);
  if (nota) nota.textContent = `Enviadas: ${a.quantidade} un. · já conferidas: ${a.quantidade - pend} · pendentes: ${pend}`;
  if (ok) { ok.value = pend; ok.max = pend; }
  if (av) { av.value = 0; av.max = pend; }
}
function selecionarPendenteDoEvento() {
  const sel = document.querySelector('#return-alocacao');
  if (!sel || !filtroRetEvento) return;
  const a = data.alocacoes.find(x => x.evento_id === filtroRetEvento && pendenciaRetorno(x) > 0);
  if (a) sel.value = a.id;
}
document.querySelector('#return-alocacao')?.addEventListener('change', preencherRetorno);
// Ao informar avarias, o "intacto" se ajusta sozinho (pode ser editado para retorno parcial)
document.querySelector('#return-damaged')?.addEventListener('input', () => {
  const a = data?.alocacoes.find(x => x.id === document.querySelector('#return-alocacao')?.value);
  if (!a) return;
  const dam = parseInt(document.querySelector('#return-damaged').value, 10) || 0;
  document.querySelector('#return-amount').value = Math.max(0, pendenciaRetorno(a) - dam);
});

// Botões da tabela: "Conferir" abre o modal já na alocação; "Desfazer" apaga as conferências dela
document.addEventListener('click', async (e) => {
  const conferir = e.target.closest('[data-return-alloc]');
  if (conferir) {
    const sel = document.querySelector('#return-alocacao');
    if (sel) sel.value = conferir.dataset.returnAlloc;
    preencherRetorno();
    document.querySelector('#return-modal')?.showModal();
    return;
  }
  const desfazer = e.target.closest('[data-undo-return]');
  if (!desfazer || desfazer.disabled) return;
  if (!confirm('Desfazer as conferências desta alocação? As unidades voltam a ficar pendentes.')) return;
  desfazer.disabled = true;
  const { error } = await db.from('conferencias').delete().eq('alocacao_id', desfazer.dataset.undoReturn);
  if (error) { desfazer.disabled = false; return alert('Não foi possível desfazer: ' + error.message); }
  await refreshData();
  renderAll();
});

function renderAll() {
  populateSelects();
  renderDashboard();
  renderEquipamentos();
  renderProfissionais();
  renderEventos();
  renderAlocacoes();
  renderEscalas();
  renderRetornos();

  window.PalcoLive?.refresh();
  window.PalcoQuality?.refresh();
  window.PalcoFin?.refresh();
}

// Filtro de evento da tela de Alocação
document.querySelector('#allocation-event')?.addEventListener('change', (e) => {
  filtroAlocEvento = e.target.value;
  renderAlocacoes();
});

// ---------- Inicialização ----------
async function refreshData() {
  data = await loadAllData();
  await sincronizarStatusRetorno(); // status do evento acompanha as conferências
}

async function initApp() {
  try {
    await refreshData();
    renderAll();
  } catch (err) {
    console.error('Erro ao carregar os dados:', err);
  }
}

// ---------- Cadastros e Salvamentos ----------
// Fecha o modal, recarrega os dados e redesenha tudo. Se o banco recusar, avisa e mantém o modal aberto.
async function concluirCadastro(resultado, modalId, limpar = []) {
  if (resultado?.error) { alert('Não foi possível salvar: ' + resultado.error.message); return false; }
  limpar.forEach(sel => { const el = document.querySelector(sel); if (el) el.value = ''; });
  document.querySelector(modalId)?.close();
  await refreshData();
  renderAll();
  return true;
}

// 1. Salvar Equipamento
document.querySelector('#save-equipment')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const nome = textOr(document.querySelector('#eq-name').value, 'Novo equipamento');
  const catId = document.querySelector('#eq-category').value || null;
  const quantidade = parseInt(document.querySelector('#eq-amount').value, 10) || 1;
  const exigeFolga = document.querySelector('#eq-rest').checked;

  const r = await db.from('equipamentos').insert({ nome, categoria_id: catId, quantidade, exige_folga: exigeFolga });
  await concluirCadastro(r, '#equipment-modal', ['#eq-name']);
});

// 2. Salvar Profissional
document.querySelector('#save-person')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const nome = textOr(document.querySelector('#person-name').value, 'Novo profissional');
  const skills = [...new Set(document.querySelector('#person-skills').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
  const opcao = DIAS_OPCOES.find(o => o.label === document.querySelector('#person-days').value);
  const dias = opcao ? opcao.dias : [1, 2, 3, 4, 5, 6, 7];

  const { data: prof, error } = await db.from('profissionais').insert({ nome, dias_disponiveis: dias }).select().single();
  if (error) return alert('Não foi possível salvar: ' + error.message);

  for (const skill of skills) {
    let habilidade = data.habilidades.find(h => h.nome === skill);
    if (!habilidade) {
      const { data: nova } = await db.from('habilidades').insert({ nome: skill }).select().single();
      habilidade = nova;
    }
    if (habilidade) await db.from('profissional_habilidades').insert({ profissional_id: prof.id, habilidade_id: habilidade.id });
  }
  await concluirCadastro({}, '#people-modal', ['#person-name', '#person-skills']);
});

// 3. Salvar Evento
document.querySelector('#save-event')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const nome = textOr(document.querySelector('#event-name').value, 'Novo evento');
  const montagem = document.querySelector('#event-build').value || null;
  const inicio = document.querySelector('#event-live-start').value || null;
  const fim = document.querySelector('#event-live-end').value || null;
  const desmontagem = document.querySelector('#event-strike').value || null;

  const r = await db.from('eventos').insert({
    nome, data_montagem: montagem, data_execucao_inicio: inicio,
    data_execucao_fim: fim, data_desmontagem: desmontagem, status: 'proposta'
  });
  await concluirCadastro(r, '#event-modal', ['#event-name']);
});

// 4. Salvar Alocação (valida período + estoque + folga; se faltar estoque, entra como Conflito/Bloqueado)
document.querySelector('#save-allocation')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const eventoId = document.querySelector('#alloc-event').value;
  const equipId = document.querySelector('#alloc-equip').value;
  const qtd = parseInt(document.querySelector('#alloc-amount').value, 10);

  if (!eventoId || !equipId) return alert('Selecione evento e equipamento.');
  if (!(qtd > 0)) return alert('Informe uma quantidade maior que zero.');

  const v = validarAlocacao(eventoId, equipId, qtd);
  if (v.semPeriodo) return alert(v.motivo); // sem datas não dá para validar o período

  // Mesmo equipamento no mesmo evento: soma na alocação existente em vez de duplicar a linha
  const existente = data.alocacoes.find(a => a.evento_id === eventoId && a.equipamento_id === equipId);
  const r = existente
    ? await db.from('alocacoes').update({ quantidade: existente.quantidade + qtd }).eq('id', existente.id)
    : await db.from('alocacoes').insert({ evento_id: eventoId, equipamento_id: equipId, quantidade: qtd });

  filtroAlocEvento = eventoId; // mostra o evento alocado na tabela
  const salvou = await concluirCadastro(r, '#allocation-modal');
  if (!salvou) return;
  document.querySelector('#alloc-amount').value = 1;
  if (!v.ok) alert(`Item alocado, mas marcado como Conflito / Bloqueado.\n\n${v.motivo}`);
});

// Prévia ao vivo dentro do modal: quanto está livre no período do evento escolhido
function atualizarPreviaAlocacao() {
  const nota = document.querySelector('#alloc-preview');
  if (!nota || !data) return;
  const eventoId = document.querySelector('#alloc-event')?.value;
  const equipId = document.querySelector('#alloc-equip')?.value;
  const qtd = parseInt(document.querySelector('#alloc-amount')?.value, 10) || 1;
  if (!eventoId || !equipId) { nota.textContent = ''; return; }
  const v = validarAlocacao(eventoId, equipId, qtd);
  nota.textContent = v.semPeriodo ? v.motivo
    : `Livre no período: ${v.disponivel} de ${v.capacidade} un.${v.ok ? '' : ' — esta quantidade entrará como Conflito / Bloqueado.'}`;
  nota.style.color = v.ok ? '' : '#ff8c72';
}
['#alloc-event', '#alloc-equip', '#alloc-amount'].forEach(sel => {
  document.querySelector(sel)?.addEventListener('input', atualizarPreviaAlocacao);
  document.querySelector(sel)?.addEventListener('change', atualizarPreviaAlocacao);
});

// 4b. Confirmar alocação do evento selecionado (proposta -> contratado, se não houver bloqueios)
document.querySelector('#confirm-allocation')?.addEventListener('click', async () => {
  const ev = data.eventos.find(e => e.id === filtroAlocEvento);
  if (!ev) return alert('Selecione um evento em "Evento selecionado" para confirmar a alocação.');
  const itens = data.alocacoes.filter(a => a.evento_id === ev.id);
  if (!itens.length) return alert('Este evento ainda não tem equipamentos alocados.');
  const conflitos = calcularConflitos();
  const bloqueados = itens.filter(a => conflitos.has(a.id)).length;
  if (bloqueados) return alert(`Não é possível confirmar: ${plural(bloqueados, 'item está', 'itens estão')} em Conflito / Bloqueado.\nReduza a quantidade ou exclua o item e tente novamente.`);

  if (ev.status !== 'proposta') return alert(`A alocação de "${ev.nome}" já está confirmada (status atual: ${ev.status.replace('_', ' ')}).`);
  const { error } = await db.from('eventos').update({ status: 'contratado' }).eq('id', ev.id);
  if (error) return alert('Não foi possível confirmar: ' + error.message);
  await refreshData();
  renderAll();
  alert(`Alocação confirmada! "${ev.nome}" agora está como Contratado.`);
});

// Ao abrir os modais: pré-seleciona o evento filtrado e atualiza as prévias
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-modal="allocation-modal"]')) {
    const sel = document.querySelector('#alloc-event');
    if (sel && filtroAlocEvento) sel.value = filtroAlocEvento;
    atualizarPreviaAlocacao();
  }
  if (e.target.closest('[data-modal="return-modal"]')) {
    selecionarPendenteDoEvento();
    preencherRetorno();
  }
});

// 5. Salvar Escala
document.querySelector('#save-schedule')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const eventoId = document.querySelector('#sched-event').value;
  const funcaoId = document.querySelector('#sched-func').value;
  const profId = document.querySelector('#sched-prof').value;

  if (!eventoId || !funcaoId || !profId) return alert('Preencha todos os campos da escala.');

  const r = await db.from('escalas').insert({ evento_id: eventoId, funcao_id: funcaoId, profissional_id: profId });
  await concluirCadastro(r, '#schedule-modal');
});

// 6. Salvar Retorno/Conferência (retornada intacta + avariada -> manutenção; aceita retorno parcial)
document.querySelector('#save-return')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const alocId = document.querySelector('#return-alocacao').value;
  if (!alocId) return alert('Selecione uma alocação pendente.');
  const aloc = data.alocacoes.find(a => a.id === alocId);
  if (!aloc) return alert('Alocação não encontrada. Atualize a página e tente de novo.');

  const intactas = parseInt(document.querySelector('#return-amount').value, 10) || 0;
  const avariadas = parseInt(document.querySelector('#return-damaged').value, 10) || 0;
  if (intactas < 0 || avariadas < 0) return alert('As quantidades não podem ser negativas.');
  if (intactas + avariadas === 0) return alert('Informe ao menos 1 unidade retornada ou avariada.');

  const pendente = pendenciaRetorno(aloc);
  if (intactas + avariadas > pendente) return alert(`Você informou ${intactas + avariadas} un., mas só ${pendente} estão pendentes nesta alocação.`);

  const r = await db.from('conferencias').insert({ alocacao_id: alocId, quantidade_retornada: intactas, quantidade_avariada: avariadas });
  // concluirCadastro -> refreshData() -> sincronizarStatusRetorno(): o status do evento é atualizado aqui
  await concluirCadastro(r, '#return-modal');
});

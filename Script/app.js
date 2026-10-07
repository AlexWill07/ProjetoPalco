// Editado por Gabriel Silva

// Script/app.js
// Camada de aplicação: carrega os dados do Supabase, renderiza as telas
// e liga os formulários de cadastro (persistência real no banco).

let data = null;

// ---------- Utilidades ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function textOr(value, fallback) { return value.trim() || fallback; }

// ---------- Helpers de exibição ----------
function categoriaNome(id) {
  const c = data?.categorias.find(x => x.id === id);
  return c ? c.nome : 'Sem categoria';
}

function habilidadesDoProfissional(profId) {
  const ids = data.profHabilidades.filter(x => x.profissional_id === profId).map(x => x.habilidade_id);
  return data.habilidades.filter(h => ids.includes(h.id)).map(h => h.nome);
}

// Dias da semana: 1=Segunda .. 7=Domingo (mesma convenção do banco).
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

// ---------- Renderização ----------
function renderEquipamentos() {
  const linhas = data.equipamentos.map(eq => {
    const folga = eq.exige_folga ? 'Sim' : 'Não';
    return `<tr>
      <td data-label="Equipamento">${esc(eq.nome)}</td>
      <td data-label="Categoria"><span class="pill">${esc(categoriaNome(eq.categoria_id))}</span></td>
      <td data-label="Quantidade">${eq.quantidade}</td>
      <td data-label="Dia de folga">${folga}</td>
      <td data-label="Disponível"><b class="available">${eq.quantidade} unidades</b></td>
      <td data-label="Ações"><button class="more" aria-label="Mais ações para ${esc(eq.nome)}">•••</button></td>
    </tr>`;
  }).join('');
  document.querySelector('#equipment-body').innerHTML = linhas + '<tr class="empty-equipment" hidden><td colspan="6">Nenhum equipamento encontrado.</td></tr>';
  document.querySelector('#equipment-results').textContent = `Exibindo ${data.equipamentos.length} equipamentos`;
}

function renderProfissionais() {
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
      <td data-label="Ações"><button class="more">•••</button></td>
    </tr>`;
  }).join('');
  document.querySelector('#people-body').innerHTML = linhas + '<tr class="empty-people" hidden><td colspan="5">Nenhum profissional encontrado.</td></tr>';
  document.querySelector('#people-results').textContent = `Exibindo ${data.profissionais.length} profissionais`;
}

function renderAll() {
  renderEquipamentos();
  renderProfissionais();
}

// ---------- Dados ----------
async function refreshData() {
  data = await loadAllData();
}

async function initApp() {
  try {
    await refreshData();
    renderAll();
  } catch (err) {
    alert('Erro ao carregar os dados do banco: ' + err.message);
  }
}

// ---------- Cadastro: Equipamento (persistência real) ----------
document.querySelector('#save-equipment').addEventListener('click', async (event) => {
  event.preventDefault();
  const nome = textOr(document.querySelector('#eq-name').value, 'Novo equipamento');
  const categoriaSelecionada = document.querySelector('#eq-category').value;
  const categoria = data.categorias.find(c => c.nome === categoriaSelecionada);
  const quantidade = parseInt(document.querySelector('#eq-amount').value, 10) || 1;
  const exigeFolga = document.querySelector('#eq-rest').checked;

  const { error } = await db.from('equipamentos').insert({
    nome,
    categoria_id: categoria ? categoria.id : null,
    quantidade,
    exige_folga: exigeFolga
  });
  if (error) { alert('Erro ao salvar: ' + error.message); return; }

  document.querySelector('#equipment-modal').close();
  await refreshData();
  renderEquipamentos();
});

// ---------- Cadastro: Profissional (persistência real) ----------
document.querySelector('#save-person').addEventListener('click', async (event) => {
  event.preventDefault();
  const nome = textOr(document.querySelector('#person-name').value, 'Novo profissional');
  const skills = [...new Set(
    document.querySelector('#person-skills').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  )];
  const opcao = DIAS_OPCOES.find(o => o.label === document.querySelector('#person-days').value);
  const dias = opcao ? opcao.dias : [1, 2, 3, 4, 5, 6, 7];

  const { data: prof, error } = await db.from('profissionais')
    .insert({ nome, dias_disponiveis: dias }).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return; }

  for (const skill of skills) {
    let habilidade = data.habilidades.find(h => h.nome === skill);
    if (!habilidade) {
      const { data: nova, error: errH } = await db.from('habilidades').insert({ nome: skill }).select().single();
      if (errH) { alert('Erro ao salvar habilitação: ' + errH.message); continue; }
      habilidade = nova;
      data.habilidades.push(habilidade);
    }
    const { error: errV } = await db.from('profissional_habilidades').insert({
      profissional_id: prof.id, habilidade_id: habilidade.id
    });
    if (errV) { alert('Erro ao vincular habilitação: ' + errV.message); }
  }

  document.querySelector('#people-modal').close();
  await refreshData();
  renderProfissionais();
});

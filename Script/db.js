// Script/db.js
// Cliente Supabase + funções de autenticação e acesso a dados.
const { createClient } = window.supabase;

const db = createClient(
  window.PALCO_CONFIG.url,
  window.PALCO_CONFIG.anonKey
);

// ---------- Autenticação ----------
async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

async function signOut() {
  return db.auth.signOut();
}

function onAuthChange(callback) {
  db.auth.onAuthStateChange((_event, session) => callback(session));
}

// ---------- Dados ----------
async function fetchTable(table) {
  const { data, error } = await db.from(table).select('*');
  if (error) throw error;
  return data;
}

// Carrega tudo de uma vez para renderizar as telas e validar as regras RN-xx.
async function loadAllData() {
  const [
    categorias, habilidades, funcoes, equipamentos, profissionais,
    profHabilidades, eventos, alocacoes, escalas, conferencias
  ] = await Promise.all([
    fetchTable('categorias'),
    fetchTable('habilidades'),
    fetchTable('funcoes'),
    fetchTable('equipamentos'),
    fetchTable('profissionais'),
    fetchTable('profissional_habilidades'),
    fetchTable('eventos'),
    fetchTable('alocacoes'),
    fetchTable('escalas'),
    fetchTable('conferencias')
  ]);

  return {
    categorias, habilidades, funcoes,
    equipamentos, profissionais, profHabilidades,
    eventos, alocacoes, escalas, conferencias
  };
}

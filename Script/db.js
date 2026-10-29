// Script/db.js
// HÍBRIDO: Tenta usar o Supabase, se falhar ou não estiver disponível, entra em modo offline temporário.

let remote = null;

// 1. Tenta inicializar o Supabase caso ele exista no HTML (Online)
if (window.supabase) {
  try {
    const { createClient } = window.supabase;
    remote = createClient(
      window.PALCO_CONFIG.url,
      window.PALCO_CONFIG.anonKey
    );
    console.log("Supabase detectado. Sistema pronto para operar online.");
  } catch (err) {
    console.warn("Aviso: Falha ao inicializar o Supabase.", err);
  }
} else {
  console.warn("Aviso: Supabase indisponível no momento. O sistema rodará com o banco de dados offline.");
}

// 2. Objeto 'db' atua como um roteador: manda para o online se existir, ou para o offline se falhar
const db = {
  from: (table) => {
    // Se o usuário ativou o modo offline manualmente, OU se o Supabase não carregou
    if (window.PalcoOffline?.active || !remote) {
      
      // Força a ativação visual do modo offline se o Supabase caiu sem o utilizador clicar no botão
      if (!window.PalcoOffline?.active && window.PalcoOffline) {
          window.PalcoOffline.enter('Modo de Segurança Local');
      }
      
      return window.PalcoOffline.from(table);
    }
    
    // Caso contrário, usa o Supabase real
    return remote.from(table);
  },
  
  auth: {
    signInWithPassword: async (credenciais) => {
      if (window.PalcoOffline?.active || !remote) {
        if (window.PalcoOffline) window.PalcoOffline.enter(credenciais.email.split('@')[0]);
        return { data: { user: { email: credenciais.email }, session: {} }, error: null };
      }
      return remote.auth.signInWithPassword(credenciais);
    },
    getSession: async () => {
      if (window.PalcoOffline?.active || !remote) {
        return { data: { session: window.PalcoOffline?.session || null } };
      }
      return remote.auth.getSession();
    },
    signOut: async () => {
      if (window.PalcoOffline?.active || !remote) {
        if (window.PalcoOffline) window.PalcoOffline.leave();
        return { error: null };
      }
      return remote.auth.signOut();
    },
    onAuthStateChange: (callback) => {
      if (remote) remote.auth.onAuthStateChange(callback);
    }
  }
};

// ---------- Autenticação ----------
async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

async function getSession() {
  const { data } = await db.auth.getSession();
  return data?.session ?? null;
}

async function signOut() {
  return db.auth.signOut();
}

function onAuthChange(callback) {
  db.auth.onAuthStateChange((_event, session) => callback(session));
}

// ---------- Carregamento de Dados ----------
async function fetchTable(table) {
  const { data, error } = await db.from(table).select('*');
  if (error) throw error;
  return data;
}

// Carrega tudo de uma vez para renderizar as telas e validar as regras.
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
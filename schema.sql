-- ============================================================================
--  PALCO VIVO · Schema do banco de dados (PostgreSQL / Supabase)
--  Como usar: Supabase → SQL Editor → cole este arquivo inteiro → Run.
--  Execute apenas uma vez em um projeto novo. (Comandos de reset no final.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Vocabulário controlado (tabelas de apoio)
--    Evitam o problema de "grafias diferentes" citado no escopo.
-- ---------------------------------------------------------------------------
create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  exige_folga boolean not null default false   -- regra padrão da categoria (RN-02)
);

create table if not exists public.habilidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique
);

create table if not exists public.funcoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  habilidade_id uuid references public.habilidades(id)  -- habilitação exigida (RN-04)
);

-- ---------------------------------------------------------------------------
-- 2) Entidades principais
-- ---------------------------------------------------------------------------
create table if not exists public.equipamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria_id uuid references public.categorias(id) on delete set null,
  quantidade integer not null default 1 check (quantidade >= 0),
  exige_folga boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists public.profissionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  dias_disponiveis integer[] not null default array[1,2,3,4,5,6,7], -- 1=Seg .. 7=Dom (RN-05)
  criado_em timestamptz not null default now()
);

create table if not exists public.profissional_habilidades (
  profissional_id uuid references public.profissionais(id) on delete cascade,
  habilidade_id uuid references public.habilidades(id) on delete cascade,
  primary key (profissional_id, habilidade_id)
);

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data_montagem date,
  data_execucao_inicio date,
  data_execucao_fim date,      -- nulo = execução de 1 dia (multidias usa 2 a 5 dias)
  data_desmontagem date,
  status text not null default 'proposta'
    check (status in ('proposta','contratado','escalado','em_execucao','encerrado','bloqueado','pendente_retorno')),
  criado_em timestamptz not null default now()
);

create table if not exists public.alocacoes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid references public.eventos(id) on delete cascade,
  equipamento_id uuid references public.equipamentos(id) on delete cascade,
  quantidade integer not null check (quantidade > 0)
);

create table if not exists public.escalas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid references public.eventos(id) on delete cascade,
  profissional_id uuid references public.profissionais(id) on delete cascade,
  funcao_id uuid references public.funcoes(id) on delete restrict
);

create table if not exists public.conferencias (
  id uuid primary key default gen_random_uuid(),
  alocacao_id uuid references public.alocacoes(id) on delete cascade,
  quantidade_retornada integer not null default 0 check (quantidade_retornada >= 0),
  quantidade_avariada integer not null default 0 check (quantidade_avariada >= 0),
  observacao text,
  conferido_em timestamptz
);

-- ---------------------------------------------------------------------------
-- 3) Dados de carga (conforme o PDF do escopo)
--    IDs fixos tornam o script reexecutável sem duplicar.
-- ---------------------------------------------------------------------------
-- Categorias
insert into public.categorias (id, nome, exige_folga) values
  ('00000000-0000-0000-0000-000000000101','Som', true),
  ('00000000-0000-0000-0000-000000000102','Luz', true),
  ('00000000-0000-0000-0000-000000000103','Estrutura', false),
  ('00000000-0000-0000-0000-000000000104','Energia', true)
on conflict (id) do nothing;

-- Habilidades
insert into public.habilidades (id, nome) values
  ('00000000-0000-0000-0000-000000000201','som'),
  ('00000000-0000-0000-0000-000000000202','luz'),
  ('00000000-0000-0000-0000-000000000203','montagem'),
  ('00000000-0000-0000-0000-000000000204','cerimonial'),
  ('00000000-0000-0000-0000-000000000205','energia')
on conflict (id) do nothing;

-- Funções (cada uma exige uma habilitação — RN-04)
insert into public.funcoes (id, nome, habilidade_id) values
  ('00000000-0000-0000-0000-000000000301','Operador de luz','00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000302','Operador de som','00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000303','Cerimonial','00000000-0000-0000-0000-000000000204'),
  ('00000000-0000-0000-0000-000000000304','Montagem','00000000-0000-0000-0000-000000000203')
on conflict (id) do nothing;

-- Equipamentos (3 com categoria + 3 sem categoria, para a tela de qualidade)
insert into public.equipamentos (id, nome, categoria_id, quantidade, exige_folga) values
  ('00000000-0000-0000-0000-000000000401','Mesa de som 32 canais','00000000-0000-0000-0000-000000000101',3,true),
  ('00000000-0000-0000-0000-000000000402','Moving head','00000000-0000-0000-0000-000000000102',16,true),
  ('00000000-0000-0000-0000-000000000403','Praticável 2x1m','00000000-0000-0000-0000-000000000103',24,false),
  ('00000000-0000-0000-0000-000000000404','Refletor PAR LED (12un.)',null,12,true),
  ('00000000-0000-0000-0000-000000000405','Gerador 15kVA',null,2,true),
  ('00000000-0000-0000-0000-000000000406','Tablado 1x1m',null,10,false)
on conflict (id) do nothing;

-- Profissionais (dias_disponiveis: 1=Seg .. 7=Dom)
insert into public.profissionais (id, nome, dias_disponiveis) values
  ('00000000-0000-0000-0000-000000000501','Ivan Marcondes', array[5,6,7]),           -- sex a dom
  ('00000000-0000-0000-0000-000000000502','Priscila Amado', array[1,2,3,4,5,6,7]),   -- todos os dias
  ('00000000-0000-0000-0000-000000000503','Denilson Rocha', array[3,4,5,6])          -- qua a sáb
on conflict (id) do nothing;

insert into public.profissional_habilidades (profissional_id, habilidade_id) values
  ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000201'), -- Ivan: som
  ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000203'), -- Ivan: montagem
  ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000204'), -- Priscila: cerimonial
  ('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000202'), -- Denilson: luz
  ('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000203')  -- Denilson: montagem
on conflict do nothing;

-- Eventos (Festival Aurora já é multidias: execução 25 a 27/10)
insert into public.eventos (id, nome, data_montagem, data_execucao_inicio, data_execucao_fim, data_desmontagem, status) values
  ('00000000-0000-0000-0000-000000000601','Casamento Ferreira','2026-10-16','2026-10-17','2026-10-17','2026-10-18','escalado'),
  ('00000000-0000-0000-0000-000000000602','Formatura Unicastelo','2026-10-17','2026-10-18','2026-10-18','2026-10-19','escalado'),
  ('00000000-0000-0000-0000-000000000603','Festival Aurora','2026-10-24','2026-10-25','2026-10-27','2026-10-28','proposta')
on conflict (id) do nothing;

-- Alocações (Casamento × Formatura disputam as mesas de som → conflito RN-01)
insert into public.alocacoes (id, evento_id, equipamento_id, quantidade) values
  ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000401',2),
  ('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000402',8),
  ('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000401',2),
  ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000402',8),
  ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-000000000403',24)
on conflict (id) do nothing;

-- Escalas (Denilson em Casamento + Formatura → conflito RN-03)
insert into public.escalas (id, evento_id, profissional_id, funcao_id) values
  ('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000304'),
  ('00000000-0000-0000-0000-000000000802','00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000803','00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000303')
on conflict (id) do nothing;

-- Conferências (Casamento: mesas devolvidas; 2 moving heads com avaria → manutenção RN-07)
insert into public.conferencias (id, alocacao_id, quantidade_retornada, quantidade_avariada, conferido_em) values
  ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000701',2,0,now()),
  ('00000000-0000-0000-0000-000000000902','00000000-0000-0000-0000-000000000702',6,2,now())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Segurança (Row Level Security)
--    Só quem está autenticado lê/escreve. A chave publishable fica no navegador,
--    mas sem login ela não acessa nenhum dado.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'categorias','habilidades','funcoes',
    'equipamentos','profissionais','profissional_habilidades',
    'eventos','alocacoes','escalas','conferencias'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "acesso autenticado" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================================
--  RESET (se quiser recomeçar do zero — apaga TODOS os dados)
-- ============================================================================
-- drop table if exists public.conferencias, public.escalas, public.alocacoes,
--   public.eventos, public.profissional_habilidades, public.profissionais,
--   public.equipamentos, public.funcoes, public.habilidades, public.categorias cascade;

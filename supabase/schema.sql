-- Schema da conta do Learnflix no Supabase (ver docs/specs/2026-10-13-conta-supabase-design.md).
-- Aplicar no SQL Editor do projeto. Idempotente: rodar de novo não quebra nada.
--
-- Toda tabela tem user_id (o dono) e RLS "só o dono vê e mexe". O app só carrega
-- a chave publishable: quem protege os dados de uma pessoa das outras é a RLS.
-- `atualizado_em` é carimbado pelo PRÓPRIO banco a cada escrita: a descida pede
-- "o que mudou desde a marca X" e o relógio de cada computador não pode bagunçar
-- essa conta.
--
-- Ids são text: são os uuids que o app já gera localmente (o curso tem o mesmo id
-- na nuvem e no cache), e bancos herdados do v1 podem ter ids em outro formato.

create or replace function public.carimbar_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create table if not exists public.colecoes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  nome text not null,
  sort_index integer,
  criado_em timestamptz not null default now(),
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.cursos (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  titulo text not null,
  origem text not null default 'local' check (origem in ('local', 'drive', 'telegram')),
  -- Curso local: o caminho da máquina em que foi criado (as outras usam pastas_por_maquina).
  -- Drive/Telegram: o link original.
  raiz text not null,
  drive_folder_id text,
  drive_resource_key text,
  telegram_peer text,
  estrutura text not null check (estrutura in ('modules', 'flat')),
  arquivado boolean not null default false,
  sort_index integer,
  colecao_id text,
  capa_rel_path text,
  criado_em timestamptz not null default now(),
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- A aula é identificada pelo rel_path dentro do curso (o mesmo princípio do cache
-- e do backup): o id local da aula muda de máquina para máquina.
create table if not exists public.aulas (
  curso_id text not null references public.cursos on delete cascade,
  rel_path text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  titulo text not null,
  modulo text,
  order_index integer not null,
  module_order integer not null default 0,
  duracao_sec double precision,
  remote_id text,
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (curso_id, rel_path)
);

create table if not exists public.progresso (
  curso_id text not null references public.cursos on delete cascade,
  rel_path text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  posicao_sec double precision not null default 0,
  mais_longe_sec double precision not null default 0,
  duracao_sec double precision,
  concluida boolean not null default false,
  concluida_em timestamptz,
  auto_concluida boolean not null default false,
  -- Quando a pessoa mexeu (relógio do app): decide quem vence no "concluída".
  alterado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (curso_id, rel_path)
);

create table if not exists public.flashcards (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  curso_id text references public.cursos on delete cascade,
  aula_rel_path text,
  minuto_sec double precision,
  frente text not null,
  verso text not null,
  anki_note_id bigint,
  criado_em timestamptz not null default now(),
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- Onde fica a pasta de um curso local em cada computador da pessoa.
create table if not exists public.pastas_por_maquina (
  curso_id text not null references public.cursos on delete cascade,
  maquina_id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  caminho text not null,
  atualizado_em timestamptz not null default now(),
  primary key (curso_id, maquina_id)
);

-- PDFs (livros, questões, apostilas). O arquivo nunca sobe: só os metadados e a
-- leitura. `leitura_em` é quando a pessoa mexeu na leitura (relógio do app).
create table if not exists public.documentos (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  titulo text not null,
  categoria text,
  tamanho bigint not null default 0,
  paginas integer,
  pagina integer not null default 1,
  lido boolean not null default false,
  lido_em timestamptz,
  leitura_em timestamptz,
  criado_em timestamptz not null default now(),
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- Onde fica o arquivo de cada PDF em cada computador da pessoa.
create table if not exists public.documentos_por_maquina (
  documento_id text not null references public.documentos on delete cascade,
  maquina_id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  caminho text not null,
  atualizado_em timestamptz not null default now(),
  primary key (documento_id, maquina_id)
);

-- Progresso nunca anda para trás: assistir offline em duas máquinas e sincronizar
-- depois não pode apagar o que uma delas assistiu (a regra do backup). Concluir ou
-- desmarcar é uma escolha da pessoa: vale a mais recente.
create or replace function public.mesclar_progresso() returns trigger
language plpgsql as $$
begin
  if new.mais_longe_sec < old.mais_longe_sec then
    new.mais_longe_sec := old.mais_longe_sec;
    new.posicao_sec := old.posicao_sec;
  end if;
  if new.alterado_em < old.alterado_em then
    new.concluida := old.concluida;
    new.concluida_em := old.concluida_em;
    new.auto_concluida := old.auto_concluida;
    new.alterado_em := old.alterado_em;
  end if;
  new.duracao_sec := coalesce(new.duracao_sec, old.duracao_sec);
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['colecoes', 'cursos', 'aulas', 'progresso', 'flashcards', 'pastas_por_maquina', 'documentos', 'documentos_por_maquina'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "so o dono" on public.%I', t);
    execute format(
      'create policy "so o dono" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
    execute format('drop trigger if exists carimbar on public.%I', t);
    execute format(
      'create trigger carimbar before insert or update on public.%I for each row execute function public.carimbar_atualizado_em()',
      t
    );
    execute format('create index if not exists %I on public.%I (user_id, atualizado_em)', t || '_descida', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

drop trigger if exists mesclar on public.progresso;
create trigger mesclar before update on public.progresso
  for each row execute function public.mesclar_progresso();

-- Leitura de PDF: duas máquinas abertas no mesmo livro, vale quem leu por último.
create or replace function public.mesclar_leitura() returns trigger
language plpgsql as $$
begin
  if old.leitura_em is not null and (new.leitura_em is null or new.leitura_em < old.leitura_em) then
    new.pagina := old.pagina;
    new.lido := old.lido;
    new.lido_em := old.lido_em;
    new.leitura_em := old.leitura_em;
  end if;
  new.paginas := coalesce(new.paginas, old.paginas);
  return new;
end $$;

drop trigger if exists mesclar on public.documentos;
create trigger mesclar before update on public.documentos
  for each row execute function public.mesclar_leitura();

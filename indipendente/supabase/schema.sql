-- Database dell'app "Spese" in modalità indipendente (Supabase).
-- Si incolla tutto in Supabase › SQL Editor › New query › Run. Si può rilanciare: non cancella niente.
-- Ogni riga appartiene a un utente (user_id) e le regole RLS fanno vedere a ciascuno solo le sue.

create table if not exists public.categories (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  name     text not null check (length(trim(name)) > 0),
  position int  not null default 0,
  primary key (user_id, name)
);

create table if not exists public.months (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month   text not null check (month ~ '^\d{4}-\d{2}$'),   -- "2026-11"
  income  numeric(10,2) not null default 0,
  primary key (user_id, month)
);

create table if not exists public.budgets (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  month    text not null check (month ~ '^\d{4}-\d{2}$'),
  category text not null,
  amount   numeric(10,2) not null default 0 check (amount >= 0),
  primary key (user_id, month, category)
);

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  date        date not null,
  description text not null check (length(trim(description)) > 0),
  amount      numeric(10,2) not null check (amount > 0),
  category    text,
  note        text,
  trip        text,               -- nome del viaggio (per le spese importate dai fogli ✈)
  created_at  timestamptz not null default now()
);
create index if not exists expenses_user_date on public.expenses (user_id, date);

-- Solo chi ha fatto l'accesso può usare le tabelle (serve se "Automatically expose new tables" è spento).
-- Chi non ha fatto l'accesso (ruolo anon) non ha nessun permesso.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.categories, public.months, public.budgets, public.expenses to authenticated;
revoke all on public.categories, public.months, public.budgets, public.expenses from anon;

alter table public.categories enable row level security;
alter table public.months     enable row level security;
alter table public.budgets    enable row level security;
alter table public.expenses   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['categories', 'months', 'budgets', 'expenses'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'solo i miei dati') then
      execute format('create policy "solo i miei dati" on public.%I for all to authenticated
                      using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

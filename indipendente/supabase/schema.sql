-- Database dell'app "Spese" in modalità indipendente (Supabase).
-- Si incolla tutto in Supabase › SQL Editor › New query › Run.
-- Si può rilanciare quando cambia: aggiunge solo quello che manca, non cancella dati.
-- Ogni riga appartiene a un utente (user_id) e le regole RLS fanno vedere a ciascuno solo le sue.

-- ---------- tabelle ----------

create table if not exists public.categories (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  name     text not null check (length(trim(name)) > 0),
  position int  not null default 0,
  primary key (user_id, name)
);

-- un mese: entrate (lista libera), surplus/deficit dei mesi scorsi e se contarlo
create table if not exists public.months (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month   text not null check (month ~ '^\d{4}-\d{2}$'),   -- "2026-11"
  income  numeric(10,2) not null default 0,               -- totale delle entrate (somma di incomes)
  primary key (user_id, month)
);
alter table public.months add column if not exists incomes  jsonb   not null default '[]'::jsonb;  -- [{name, amount}]
alter table public.months add column if not exists carry    numeric(10,2) not null default 0;     -- surplus/deficit riportato
alter table public.months add column if not exists carry_on boolean not null default false;       -- conta nelle entrate?

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
  trip        text,               -- nome del viaggio: la spesa sta nel viaggio (categoria = categoria del viaggio)
  created_at  timestamptz not null default now()
);
create index if not exists expenses_user_date on public.expenses (user_id, date);

create table if not exists public.trips (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  note       text,
  position   int not null default 0,
  primary key (user_id, name)
);

create table if not exists public.trip_categories (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  trip     text not null,
  name     text not null check (length(trim(name)) > 0),
  budget   numeric(10,2) not null default 0 check (budget >= 0),
  position int not null default 0,
  primary key (user_id, trip, name)
);

create table if not exists public.subscriptions (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  id       uuid not null default gen_random_uuid(),
  name     text not null check (length(trim(name)) > 0),
  amount   numeric(10,2) not null check (amount > 0),
  day      int not null default 1 check (day between 1 and 31),
  auto     boolean not null default false,               -- inserirlo da solo ogni mese
  position int not null default 0,
  primary key (user_id, id)
);

-- impostazioni e scelte del piano (quiz, % da mettere da parte, mesi nascosti, soldi sul conto, correzioni…)
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data    jsonb not null default '{}'::jsonb
);

-- ---------- permessi: solo chi ha fatto l'accesso, e solo sulle sue righe ----------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.categories, public.months, public.budgets, public.expenses,
  public.trips, public.trip_categories, public.subscriptions, public.settings to authenticated;
revoke all on public.categories, public.months, public.budgets, public.expenses,
  public.trips, public.trip_categories, public.subscriptions, public.settings from anon;

do $$
declare t text;
begin
  foreach t in array array['categories', 'months', 'budgets', 'expenses', 'trips', 'trip_categories', 'subscriptions', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'solo i miei dati') then
      execute format('create policy "solo i miei dati" on public.%I for all to authenticated
                      using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

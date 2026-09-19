-- =============================================================================
-- Encargos para Venezuela - Esquema de base de datos (Supabase / Postgres)
-- -----------------------------------------------------------------------------
-- Como usar:
--   1. Abre tu proyecto en Supabase.
--   2. Ve al "SQL Editor" (Editor SQL).
--   3. Pega TODO este archivo y ejecuta ("Run").
--   4. Confirma que Realtime queda activado para las tablas `people` e `items`
--      (Database -> Replication / Publications -> supabase_realtime).
--
-- El script es seguro de re-ejecutar: usa CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS antes de crear cada politica y protege el ALTER de la
-- publicacion para que no falle si las tablas ya estaban agregadas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabla: people (personas)
-- -----------------------------------------------------------------------------
-- Cada persona tiene su propia lista de articulos.
-- `position` permite ordenar manualmente; `created_at` es el desempate estable.
create table if not exists public.people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   int,
  created_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- Tabla: items (articulos)
-- -----------------------------------------------------------------------------
-- Cada articulo pertenece a una persona. Al borrar una persona se borran sus
-- articulos automaticamente gracias a ON DELETE CASCADE (la app confia en esto).
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people (id) on delete cascade,
  name       text not null,
  quantity   int default 1,
  notes      text,
  category   text,
  done       boolean default false,
  created_at timestamptz default now()
);

-- Indice para acelerar la busqueda de articulos por persona.
create index if not exists items_person_id_idx on public.items (person_id);

-- -----------------------------------------------------------------------------
-- Realtime: agregar ambas tablas a la publicacion `supabase_realtime`
-- -----------------------------------------------------------------------------
-- La app se suscribe a postgres_changes (INSERT/UPDATE/DELETE) en ambas tablas
-- para sincronizar en tiempo real entre dispositivos. El bloque DO protege el
-- ALTER para que no falle si una tabla ya forma parte de la publicacion.
do $$
begin
  begin
    alter publication supabase_realtime add table public.people;
  exception
    when duplicate_object then null; -- ya estaba en la publicacion
  end;
  begin
    alter publication supabase_realtime add table public.items;
  exception
    when duplicate_object then null; -- ya estaba en la publicacion
  end;
end
$$;

-- -----------------------------------------------------------------------------
-- RLS (Row Level Security) y politicas de acceso
-- -----------------------------------------------------------------------------
-- COMPROMISO DE DISENO / SEGURIDAD:
-- Esta app no tiene sistema de autenticacion (login). Es una lista FAMILIAR
-- pensada para compartirse abiertamente: cualquiera con el enlace y la clave
-- `anon` (que viaja en el navegador) puede leer y editar la lista. Por eso las
-- politicas de abajo son PERMISIVAS para el rol `anon`: permiten SELECT, INSERT,
-- UPDATE y DELETE sin restricciones. Es intencional y adecuado para uso familiar
-- de bajo riesgo, pero significa que la lista es "abiertamente editable".
--
-- COMO ENDURECERLO MAS ADELANTE (sin montar un login completo):
--   * Opcion ligera: poner la app detras de una "passphrase" (contrasena
--     compartida) validada por una Edge Function de Supabase que sea la unica
--     que reciba una clave con permisos; el cliente solo hablaria con esa
--     funcion en vez de con las tablas directamente.
--   * Opcion completa: activar Supabase Auth y cambiar estas politicas para
--     exigir `auth.role() = 'authenticated'` (o filtrar por `auth.uid()`).
-- Mientras uses la clave `anon` con RLS activado, NO se exponen otras tablas ni
-- operaciones fuera de las que estas politicas permiten.
-- -----------------------------------------------------------------------------

-- Activar Row Level Security en ambas tablas.
alter table public.people enable row level security;
alter table public.items  enable row level security;

-- Politicas para `people` (acceso abierto para el rol anon).
drop policy if exists "people_anon_select" on public.people;
drop policy if exists "people_anon_insert" on public.people;
drop policy if exists "people_anon_update" on public.people;
drop policy if exists "people_anon_delete" on public.people;

create policy "people_anon_select" on public.people
  for select to anon using (true);
create policy "people_anon_insert" on public.people
  for insert to anon with check (true);
create policy "people_anon_update" on public.people
  for update to anon using (true) with check (true);
create policy "people_anon_delete" on public.people
  for delete to anon using (true);

-- Politicas para `items` (acceso abierto para el rol anon).
drop policy if exists "items_anon_select" on public.items;
drop policy if exists "items_anon_insert" on public.items;
drop policy if exists "items_anon_update" on public.items;
drop policy if exists "items_anon_delete" on public.items;

create policy "items_anon_select" on public.items
  for select to anon using (true);
create policy "items_anon_insert" on public.items
  for insert to anon with check (true);
create policy "items_anon_update" on public.items
  for update to anon using (true) with check (true);
create policy "items_anon_delete" on public.items
  for delete to anon using (true);

-- =============================================================================
-- Fin del esquema.
-- =============================================================================

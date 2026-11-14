-- LangTutor sync schema. One generic document table; each row is one user-owned record
-- (tbl = 'cards' | 'reviewLog' | 'settings' | 'userEntries' | 'userExamples' | 'userGlosses').
-- Conflict rule: last-write-wins on the CLIENT clock (updated_at, ms epoch). The pull cursor is the
-- SERVER clock (synced_at), so a device with a wrong clock cannot make others miss changes.

create table if not exists public.user_docs (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  tbl        text    not null,
  id         text    not null,
  data       jsonb   not null,
  updated_at bigint  not null,                       -- client updatedAt (ms epoch), used for LWW
  deleted    boolean not null default false,         -- soft delete (tombstone)
  synced_at  timestamptz not null default clock_timestamp(), -- server time of last change, pull cursor
  primary key (user_id, tbl, id)
);

create index if not exists user_docs_user_updated_idx on public.user_docs (user_id, updated_at);
create index if not exists user_docs_user_synced_idx  on public.user_docs (user_id, synced_at, tbl, id);

-- synced_at is always set by the server, whatever the client sends.
create or replace function public.user_docs_touch() returns trigger
language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists user_docs_touch on public.user_docs;
create trigger user_docs_touch before insert or update on public.user_docs
  for each row execute function public.user_docs_touch();

-- Row level security: every user sees and changes only their own rows.
alter table public.user_docs enable row level security;

drop policy if exists user_docs_select on public.user_docs;
drop policy if exists user_docs_insert on public.user_docs;
drop policy if exists user_docs_update on public.user_docs;
drop policy if exists user_docs_delete on public.user_docs;
create policy user_docs_select on public.user_docs for select using (user_id = auth.uid());
create policy user_docs_insert on public.user_docs for insert with check (user_id = auth.uid());
create policy user_docs_update on public.user_docs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_docs_delete on public.user_docs for delete using (user_id = auth.uid());

-- Table privileges (RLS still filters). anon may only "see" nothing; it is used by the keep-alive ping.
grant select on public.user_docs to anon;
grant select, insert, update, delete on public.user_docs to authenticated;

-- Push: docs is a jsonb array of {tbl, id, data, updated_at, deleted}.
-- A row is only overwritten when the incoming updated_at is NEWER (last-write-wins); stale or
-- duplicate pushes are no-ops and do not bump synced_at (so devices never ping-pong).
create or replace function public.upsert_docs(docs jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  with incoming as (
    select d->>'tbl' as tbl, d->>'id' as id, d->'data' as data,
           (d->>'updated_at')::bigint as updated_at, coalesce((d->>'deleted')::boolean, false) as deleted
    from jsonb_array_elements(docs) d
  ), up as (
    insert into public.user_docs as u (user_id, tbl, id, data, updated_at, deleted)
    select auth.uid(), tbl, id, data, updated_at, deleted from incoming
    on conflict (user_id, tbl, id) do update
      set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
      where excluded.updated_at > u.updated_at
    returning 1
  )
  select count(*) into n from up;
  return n;
end $$;

-- Pull: rows changed after the keyset cursor (synced_at, tbl, id), oldest first.
create or replace function public.pull_docs(p_at timestamptz, p_tbl text, p_id text, p_limit integer default 1000)
returns setof public.user_docs
language sql stable security invoker set search_path = public as $$
  select * from public.user_docs
  where user_id = auth.uid() and (synced_at, tbl, id) > (p_at, p_tbl, p_id)
  order by synced_at, tbl, id
  limit least(greatest(p_limit, 1), 1000)
$$;

revoke all on function public.upsert_docs(jsonb) from public, anon;
revoke all on function public.pull_docs(timestamptz, text, text, integer) from public, anon;
grant execute on function public.upsert_docs(jsonb) to authenticated;
grant execute on function public.pull_docs(timestamptz, text, text, integer) to authenticated;

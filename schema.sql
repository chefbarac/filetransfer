-- ============================================================
-- Printshop Receive — Supabase schema
-- Run this once in your Supabase project's SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

-- One row per business/shop using this tool. Each has its own dashboard
-- password and only ever sees its own orders — this is what lets other
-- print shops use the same deployment as a B2B tool.
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_name text not null default 'Walk-in customer',
  folder_name text not null default 'Untitled order',
  status text not null default 'uploading'
    check (status in ('uploading','received','printing','ready','picked_up')),
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day')
);

-- Lock every table down. All access goes through the functions below,
-- which run with the privileges of the function owner (SECURITY DEFINER),
-- not the anonymous caller. This keeps the anon key from being able to
-- read/write tables directly, even though it's public in the frontend JS.
alter table businesses enable row level security;
alter table orders enable row level security;
-- (No policies are created, which means: no direct access at all via PostgREST.)

-- ---------- One-time setup: create your business ----------
-- Replace 'Your Print Shop' and 'change-me' below, then run this once.
-- To onboard a second business later (B2B), just run another insert like
-- this one with a different name and password.
insert into businesses (name, password_hash)
values ('Your Print Shop', crypt('change-me', gen_salt('bf')));

-- ---------- Functions (called from the frontend via supabase.rpc) ----------

-- Looks up which business a dashboard password belongs to.
-- Returns nothing if the password doesn't match any business.
create or replace function verify_business_password(pw text)
returns table(id uuid, name text)
language sql security definer as $$
  select b.id, b.name from businesses b where b.password_hash = crypt(pw, b.password_hash);
$$;

-- Shared helper: resolves a password to a business id, or raises.
create or replace function resolve_business(pw text)
returns uuid
language plpgsql security definer as $$
declare bid uuid;
begin
  select id into bid from businesses where password_hash = crypt(pw, password_hash);
  if bid is null then
    raise exception 'invalid dashboard password';
  end if;
  return bid;
end; $$;

-- Change a business's own dashboard password (must supply the current one).
create or replace function change_business_password(old_pw text, new_pw text)
returns boolean
language plpgsql security definer as $$
declare bid uuid;
begin
  bid := resolve_business(old_pw);
  update businesses set password_hash = crypt(new_pw, gen_salt('bf')) where id = bid;
  return true;
end; $$;

-- Admin creates a one-time receive link. Expires 24h after creation.
create or replace function admin_create_order(admin_pw text, p_customer_name text, p_folder_name text)
returns uuid
language plpgsql security definer as $$
declare bid uuid;
declare new_id uuid;
begin
  bid := resolve_business(admin_pw);
  insert into orders (business_id, customer_name, folder_name)
  values (bid, coalesce(nullif(p_customer_name,''), 'Walk-in customer'), coalesce(nullif(p_folder_name,''), 'Untitled order'))
  returning id into new_id;
  return new_id;
end; $$;

-- Admin dashboard: list this business's orders (most recent first).
create or replace function admin_list_orders(admin_pw text)
returns setof orders
language plpgsql security definer as $$
declare bid uuid;
begin
  bid := resolve_business(admin_pw);
  return query select * from orders where business_id = bid order by created_at desc;
end; $$;

-- Admin updates an order's status (scoped to their own business's orders).
create or replace function admin_update_status(
    admin_pw text,
    order_id uuid,
    new_status text
)
returns boolean
language plpgsql
security definer
as $$
declare
    bid uuid;
begin
    -- Verify the business password
    bid := resolve_business(admin_pw);

    -- Update the order only if it belongs to this business
    if new_status = 'picked_up' then
        update orders
        set
            status = new_status,
            files = '[]'::jsonb
        where id = order_id
          and business_id = bid;

        if not found then
            raise exception 'Order not found';
        end if;
    else
        update orders
        set status = new_status
        where id = order_id
          and business_id = bid;

        if not found then
            raise exception 'Order not found';
        end if;
    end if;

    return true;
end;
$$;

-- Anyone holding the exact order id (an unguessable UUID) can check status —
-- this is what the customer's link polls. Deliberately does not require a
-- password: the link itself is the secret. Also reports whether the link
-- has passed its 24-hour expiry and which shop it belongs to.
create or replace function get_order_status(order_id uuid)
returns table(status text, folder_name text, files jsonb, expired boolean, business_name text)
language sql security definer as $$
  select o.status, o.folder_name, o.files, (now() > o.expires_at), b.name
  from orders o join businesses b on b.id = o.business_id
  where o.id = order_id;
$$;


-- Customer's browser calls this after each file finishes uploading to storage,
-- to append it to the order's file list and flip status to 'received' on first
-- file. Rejects uploads once the order's 24-hour link has expired.
create or replace function append_order_file(order_id uuid, file_name text, storage_path text, size_bytes bigint)
returns boolean
language plpgsql security definer as $$
begin
  if (select now() > expires_at from orders where id = order_id) then
    raise exception 'This link has expired.';
  end if;
  update orders
    set files = files || jsonb_build_object(
          'name', file_name, 'path', storage_path, 'size', size_bytes,
          'uploaded_at', now()
        ),
        status = case when status = 'uploading' then 'received' else status end
    where id = order_id;
  return true;
end; $$;

create or replace function get_order_files(order_id uuid)
returns jsonb
language sql
security definer
as $$
    select files
    from orders
    where id = order_id;
$$;

-- ============================================================
-- Storage: create a bucket named "uploads" (Storage → New bucket → Public bucket = OFF).
-- Then add these policies on storage.objects (Storage → Policies):
--
-- 1) INSERT (upload) — allow anyone to upload only, not list/browse:
--    Policy name: anon can upload
--    Allowed operation: INSERT
--    Target roles: anon
--    USING/WITH CHECK expression: bucket_id = 'uploads'
--
-- 2) SELECT (download) — needed so the admin dashboard can fetch files back:
--    Policy name: anon can read
--    Allowed operation: SELECT
--    Target roles: anon
--    USING expression: bucket_id = 'uploads'
--
-- Files are stored at path "<order_id>/<filename>" — the order id (a UUID) is
-- the only thing that scopes access, same as the status-check link above.
-- ============================================================

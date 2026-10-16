-- ============================================================
-- Store backend schema for Supabase (free tier is enough)
-- How to use: Supabase dashboard -> SQL Editor -> New query ->
-- paste this whole file -> Run. Done. See SUPABASE-SETUP.md.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

-- Per-account profile extensions: avatar, banner, and settings live here so
-- they follow the account across devices. Columns are additive (IF NOT EXISTS)
-- so this script is safe to rerun on existing projects.
alter table profiles add column if not exists avatar_url text not null default '';
alter table profiles add column if not exists banner_url text not null default '';
alter table profiles add column if not exists settings jsonb not null default '{}'::jsonb;

-- Per-account game library, preferences, and supported local save data.
create table if not exists game_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists mist_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  owned_decorations text[] not null default '{}',
  active_decoration text,
  updated_at timestamptz not null default now()
);

create table if not exists mist_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gift_type text not null check (gift_type in ('mist', 'blossom')),
  amount integer,
  sender_email text not null default 'Admin',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check ((gift_type = 'mist' and amount between 1 and 100000) or (gift_type = 'blossom' and amount is null))
);

create table if not exists wallpapers (
  id text primary key,
  name text not null,
  author text not null default 'unknown',
  author_email text not null default '',
  kind text not null default 'image',           -- 'image' | 'video'
  url text not null default '',
  status text not null default 'pending',       -- 'pending' | 'live'
  created_at timestamptz default now()
);

create table if not exists likes (
  wallpaper_id text references wallpapers (id) on delete cascade,
  user_email text not null,
  created_at timestamptz default now(),
  primary key (wallpaper_id, user_email)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  wallpaper_id text references wallpapers (id) on delete cascade,
  reporter_email text not null default '',
  reason text not null default 'Other',
  created_at timestamptz default now()
);

-- ---------- File storage buckets ----------
-- wallpapers: public community wallpaper files
insert into storage.buckets (id, name, public)
values ('wallpapers', 'wallpapers', true)
on conflict (id) do nothing;
-- avatars: public profile pictures (one per account)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
-- banners: public profile banners (one per account)
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- ---------- Row Level Security ----------
alter table profiles enable row level security;
alter table game_data enable row level security;
alter table mist_wallets enable row level security;
alter table mist_gifts enable row level security;
alter table wallpapers enable row level security;
alter table likes enable row level security;
alter table reports enable row level security;

-- The admin account. Change this if your admin email ever changes.
-- (It must match ADMIN_EMAILS in script.js.)
-- We use a helper via a simple repeated check so there is no extra setup.

-- profiles: users manage their own row, admin sees all
drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select
  using (
    id = auth.uid()
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'iez123@proton.me'
    or split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1) = 'iez123'
  );
drop policy if exists "profiles insert own" on profiles;
create policy "profiles insert own" on profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles for update to authenticated
  using (id = auth.uid());
grant select, insert, update on profiles to authenticated;

-- Game data is private to its signed-in account.
drop policy if exists "game data read own" on game_data;
create policy "game data read own" on game_data for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "game data insert own" on game_data;
create policy "game data insert own" on game_data for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "game data update own" on game_data;
create policy "game data update own" on game_data for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update on game_data to authenticated;

-- Mist wallets are readable by their owner and the site admin. Mutations go
-- through the guarded RPC functions below so clients cannot edit balances.
drop policy if exists "mist wallets read" on mist_wallets;
create policy "mist wallets read" on mist_wallets for select to authenticated
  using (
    user_id = auth.uid()
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'iez123@proton.me'
    or split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1) = 'iez123'
  );
revoke all on mist_wallets from anon, authenticated;
grant select on mist_wallets to authenticated;
revoke all on mist_gifts from anon, authenticated;

create or replace function admin_credit_mist(target_user_id uuid, amount integer)
returns mist_wallets
language plpgsql
security definer
set search_path = public
as $$
declare wallet mist_wallets;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'iez123@proton.me'
     and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1) <> 'iez123' then
    raise exception 'admin access required';
  end if;
  if amount is null or amount < 1 or amount > 100000 then
    raise exception 'amount must be between 1 and 100000';
  end if;
  insert into mist_wallets (user_id, balance)
  values (target_user_id, amount)
  on conflict (user_id) do update
    set balance = mist_wallets.balance + excluded.balance,
        updated_at = now()
  returning * into wallet;
  return wallet;
end;
$$;

create or replace function admin_queue_mist_gift(p_target_user_id uuid, p_gift_type text, p_amount integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare gift_id uuid;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'iez123@proton.me'
     and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1) <> 'iez123' then
    raise exception 'admin access required';
  end if;
  if p_gift_type = 'mist' and (p_amount is null or p_amount < 1 or p_amount > 100000) then
    raise exception 'Mist gifts must be between 1 and 100000';
  elsif p_gift_type = 'blossom' then
    p_amount := null;
  elsif p_gift_type not in ('mist', 'blossom') then
    raise exception 'unknown gift type';
  end if;
  insert into mist_gifts (user_id, gift_type, amount, sender_email)
  values (p_target_user_id, p_gift_type, p_amount, coalesce(auth.jwt() ->> 'email', 'Admin'))
  returning id into gift_id;
  return gift_id;
end;
$$;

create or replace function claim_mist_gifts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare gift record; result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  insert into mist_wallets (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  for gift in
    select id, gift_type, amount, sender_email
    from mist_gifts
    where user_id = auth.uid() and claimed_at is null
    order by created_at, id
    for update
  loop
    if gift.gift_type = 'mist' then
      update mist_wallets
        set balance = balance + gift.amount, updated_at = now()
        where user_id = auth.uid();
    elsif gift.gift_type = 'blossom' then
      update mist_wallets
        set owned_decorations = case
          when 'blossom' = any(owned_decorations) then owned_decorations
          else array_append(owned_decorations, 'blossom')
        end,
        updated_at = now()
        where user_id = auth.uid();
    end if;
    update mist_gifts set claimed_at = now() where id = gift.id;
    result := result || jsonb_build_array(jsonb_build_object(
      'gift_type', gift.gift_type,
      'amount', gift.amount,
      'sender_email', gift.sender_email
    ));
  end loop;
  return result;
end;
$$;

create or replace function purchase_avatar_decoration(p_decoration_id text)
returns mist_wallets
language plpgsql
security definer
set search_path = public
as $$
declare price integer; wallet mist_wallets;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  price := case p_decoration_id
    when 'blossom' then 300
    else null
  end;
  if price is null then raise exception 'unknown decoration'; end if;
  insert into mist_wallets (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update mist_wallets
    set balance = balance - price,
        owned_decorations = array_append(owned_decorations, p_decoration_id),
        active_decoration = p_decoration_id,
        updated_at = now()
    where user_id = auth.uid()
      and balance >= price
      and not (p_decoration_id = any(owned_decorations))
    returning * into wallet;
  if not found then raise exception 'not enough Mist or decoration already owned'; end if;
  return wallet;
end;
$$;

create or replace function equip_avatar_decoration(p_decoration_id text)
returns mist_wallets
language plpgsql
security definer
set search_path = public
as $$
declare wallet mist_wallets;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_decoration_id not in ('blossom') then
    raise exception 'unknown decoration';
  end if;
  update mist_wallets
    set active_decoration = p_decoration_id, updated_at = now()
    where user_id = auth.uid() and p_decoration_id = any(owned_decorations)
    returning * into wallet;
  if not found then raise exception 'decoration is not owned'; end if;
  return wallet;
end;
$$;

create or replace function unequip_avatar_decoration()
returns mist_wallets
language plpgsql
security definer
set search_path = public
as $$
declare wallet mist_wallets;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  update mist_wallets
    set active_decoration = null, updated_at = now()
    where user_id = auth.uid()
    returning * into wallet;
  if not found then raise exception 'wallet not found'; end if;
  return wallet;
end;
$$;

revoke all on function admin_credit_mist(uuid, integer) from public, anon;
revoke all on function admin_queue_mist_gift(uuid, text, integer) from public, anon;
revoke all on function claim_mist_gifts() from public, anon;
revoke all on function purchase_avatar_decoration(text) from public, anon;
revoke all on function equip_avatar_decoration(text) from public, anon;
revoke all on function unequip_avatar_decoration() from public, anon;
grant execute on function admin_credit_mist(uuid, integer) to authenticated;
grant execute on function admin_queue_mist_gift(uuid, text, integer) to authenticated;
grant execute on function claim_mist_gifts() to authenticated;
grant execute on function purchase_avatar_decoration(text) to authenticated;
grant execute on function equip_avatar_decoration(text) to authenticated;
grant execute on function unequip_avatar_decoration() to authenticated;

-- wallpapers: everyone reads live ones (+ own pending + admin sees all)
drop policy if exists "wallpapers read" on wallpapers;
create policy "wallpapers read" on wallpapers for select
  using (
    status = 'live'
    or author_email = (auth.jwt() ->> 'email')
    or (auth.jwt() ->> 'email') = 'iez123@proton.me'
  );
-- anyone signed in can submit, but only as pending (admins may post live)
drop policy if exists "wallpapers submit" on wallpapers;
create policy "wallpapers submit" on wallpapers for insert to authenticated
  with check (
    status = 'pending'
    or (auth.jwt() ->> 'email') = 'iez123@proton.me'
  );
-- only the admin can approve/edit/delete
drop policy if exists "wallpapers admin write" on wallpapers;
create policy "wallpapers admin write" on wallpapers for update to authenticated
  using ((auth.jwt() ->> 'email') = 'iez123@proton.me');
drop policy if exists "wallpapers admin delete" on wallpapers;
create policy "wallpapers admin delete" on wallpapers for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'iez123@proton.me');

-- likes: public counts, users only touch their own (admin can clean up)
drop policy if exists "likes read" on likes;
create policy "likes read" on likes for select using (true);
drop policy if exists "likes add own" on likes;
create policy "likes add own" on likes for insert to authenticated
  with check (user_email = (auth.jwt() ->> 'email'));
drop policy if exists "likes remove own" on likes;
create policy "likes remove own" on likes for delete to authenticated
  using (
    user_email = (auth.jwt() ->> 'email')
    or (auth.jwt() ->> 'email') = 'iez123@proton.me'
  );

-- reports: signed-in users can file them, only admin reads/clears them
drop policy if exists "reports file" on reports;
create policy "reports file" on reports for insert to authenticated
  with check (reporter_email = (auth.jwt() ->> 'email'));
drop policy if exists "reports admin read" on reports;
create policy "reports admin read" on reports for select to authenticated
  using ((auth.jwt() ->> 'email') = 'iez123@proton.me');
drop policy if exists "reports admin delete" on reports;
create policy "reports admin delete" on reports for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'iez123@proton.me');

-- storage: anyone can view wallpaper files, signed-in users can upload,
-- only the admin can overwrite/delete them
drop policy if exists "wallpaper files read" on storage.objects;
create policy "wallpaper files read" on storage.objects for select
  using (bucket_id = 'wallpapers');
drop policy if exists "wallpaper files upload" on storage.objects;
create policy "wallpaper files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wallpapers');
drop policy if exists "wallpaper files admin write" on storage.objects;
create policy "wallpaper files admin write" on storage.objects for update to authenticated
  using (bucket_id = 'wallpapers' and (auth.jwt() ->> 'email') = 'iez123@proton.me');
drop policy if exists "wallpaper files admin delete" on storage.objects;
create policy "wallpaper files admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wallpapers' and (auth.jwt() ->> 'email') = 'iez123@proton.me');

-- avatars: anyone can view, owners can upload/replace/delete their own avatar.
-- Object path is avatars/<auth.uid>/<file>, so the owner check matches the
-- second path segment to the authenticated user id.
drop policy if exists "avatar files read" on storage.objects;
create policy "avatar files read" on storage.objects for select
  using (bucket_id = 'avatars');
drop policy if exists "avatar files upload" on storage.objects;
create policy "avatar files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name like ('avatars/' || auth.uid()::text || '/%'));
drop policy if exists "avatar files owner write" on storage.objects;
create policy "avatar files owner write" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name like ('avatars/' || auth.uid()::text || '/%'));
drop policy if exists "avatar files owner delete" on storage.objects;
create policy "avatar files owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name like ('avatars/' || auth.uid()::text || '/%'));

-- banners: anyone can view, owners can upload/replace/delete their own banner.
-- Object path is banners/<auth.uid>/<file>.
drop policy if exists "banner files read" on storage.objects;
create policy "banner files read" on storage.objects for select
  using (bucket_id = 'banners');
drop policy if exists "banner files upload" on storage.objects;
create policy "banner files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'banners' and name like ('banners/' || auth.uid()::text || '/%'));
drop policy if exists "banner files owner write" on storage.objects;
create policy "banner files owner write" on storage.objects for update to authenticated
  using (bucket_id = 'banners' and name like ('banners/' || auth.uid()::text || '/%'));
drop policy if exists "banner files owner delete" on storage.objects;
create policy "banner files owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and name like ('banners/' || auth.uid()::text || '/%'));

-- ---------- Drift private messaging ----------
-- Usernames are visible only to the account owner directly. Friend lookup and
-- conversation membership are mediated by the authenticated RPC functions.
-- Handles look like iez#0001: the base name plus a 4-digit tag. The pair
-- (username, discriminator) is unique, so many people can share a base name
-- but nobody else can claim iez#0001 until that account is deleted.
create table if not exists drift_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  discriminator text not null default '0001' check (discriminator ~ '^[0-9]{4}$' and discriminator <> '0000'),
  created_at timestamptz not null default now(),
  unique (username, discriminator)
);
-- Migration for installs created before tags existed (base name was unique).
alter table drift_users add column if not exists discriminator text not null default '0001'
  check (discriminator ~ '^[0-9]{4}$' and discriminator <> '0000');
-- Profile pictures are browser-local by default; this optional cloud copy lets
-- friends see each other's avatars on any device (small data-URL images only).
alter table drift_users add column if not exists avatar_url text not null default '';
alter table drift_users drop constraint if exists drift_users_username_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drift_users_username_discriminator_key'
  ) then
    alter table drift_users add constraint drift_users_username_discriminator_key
      unique (username, discriminator);
  end if;
end $$;
alter table drift_users enable row level security;
drop policy if exists "drift username read own" on drift_users;
create policy "drift username read own" on drift_users for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "drift username insert own" on drift_users;
create policy "drift username insert own" on drift_users for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "drift username update own" on drift_users;
create policy "drift username update own" on drift_users for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on drift_users to authenticated;

create table if not exists drift_friendships (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low::text < user_high::text),
  check (requested_by = user_low or requested_by = user_high)
);
alter table drift_friendships enable row level security;
drop policy if exists "drift friendship read participants" on drift_friendships;
create policy "drift friendship read participants" on drift_friendships for select to authenticated
  using (auth.uid() in (user_low, user_high));
-- Mutations still run through the guarded RPCs below.
revoke all on drift_friendships from anon, authenticated;
grant select on drift_friendships to authenticated;

create table if not exists drift_messages (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000 and btrim(body) <> ''),
  created_at timestamptz not null default now(),
  check (user_low::text < user_high::text),
  check (sender_id = user_low or sender_id = user_high)
);
create index if not exists drift_messages_thread_time on drift_messages (user_low, user_high, created_at desc);
alter table drift_messages enable row level security;
drop policy if exists "drift messages send to accepted friend" on drift_messages;
create policy "drift messages send to accepted friend" on drift_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from drift_friendships f
      where f.user_low = drift_messages.user_low
        and f.user_high = drift_messages.user_high
        and f.status = 'accepted'
        and auth.uid() in (f.user_low, f.user_high)
    )
  );
revoke all on drift_messages from anon, authenticated;
grant insert on drift_messages to authenticated;

create or replace function drift_claim_username(p_base text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare base text; tag text; n integer; existing drift_users%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  base := lower(btrim(coalesce(p_base, '')));
  base := regexp_replace(base, '^@', '');
  if position('#' in base) > 0 then base := split_part(base, '#', 1); end if;
  if base !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Enter a name with 3-24 letters, numbers, or underscores.';
  end if;
  select * into existing from drift_users where user_id = auth.uid();
  if found and existing.username = base then
    return jsonb_build_object(
      'username', existing.username,
      'discriminator', existing.discriminator,
      'handle', existing.username || '#' || existing.discriminator
    );
  end if;
  for n in 1..9999 loop
    tag := lpad(n::text, 4, '0');
    begin
      insert into drift_users (user_id, username, discriminator)
      values (auth.uid(), base, tag)
      on conflict (user_id) do update
        set username = excluded.username,
            discriminator = excluded.discriminator;
      return jsonb_build_object('username', base, 'discriminator', tag, 'handle', base || '#' || tag);
    exception when unique_violation then
      continue;
    end;
  end loop;
  raise exception 'No tags left for that name. Try another name.';
end;
$$;

create or replace function drift_request_friend(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare raw text; base text; tag text; target_id uuid; low_id uuid; high_id uuid; changed integer;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  raw := lower(btrim(coalesce(p_username, '')));
  raw := regexp_replace(raw, '^@', '');
  if position('#' in raw) = 0 then
    raise exception 'Enter the full tag, like iez#0001.';
  end if;
  base := split_part(raw, '#', 1);
  tag := split_part(raw, '#', 2);
  if base !~ '^[a-z0-9_]{3,24}$' or tag !~ '^[0-9]{4}$' or tag = '0000' then
    raise exception 'Enter the full tag, like iez#0001.';
  end if;
  select user_id into target_id
    from drift_users
    where username = base and discriminator = tag;
  if target_id is null then raise exception 'Drift username not found'; end if;
  if target_id = auth.uid() then raise exception 'cannot add yourself'; end if;
  if auth.uid()::text < target_id::text then low_id := auth.uid(); high_id := target_id;
  else low_id := target_id; high_id := auth.uid(); end if;
  insert into drift_friendships (user_low, user_high, requested_by, status)
    values (low_id, high_id, auth.uid(), 'pending')
    on conflict (user_low, user_high) do update
      set requested_by = excluded.requested_by, status = 'pending', created_at = now()
      where drift_friendships.status = 'declined';
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'friend request or conversation already exists'; end if;
  return jsonb_build_object('sent', true);
end;
$$;

create or replace function drift_respond(p_friend_user uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare low_id uuid; high_id uuid; changed integer;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_friend_user is null or p_friend_user = auth.uid() then raise exception 'invalid friend'; end if;
  if auth.uid()::text < p_friend_user::text then low_id := auth.uid(); high_id := p_friend_user;
  else low_id := p_friend_user; high_id := auth.uid(); end if;
  update drift_friendships
    set status = case when p_accept then 'accepted' else 'declined' end,
        created_at = now()
    where user_low = low_id and user_high = high_id
      and status = 'pending' and requested_by = p_friend_user;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'incoming friend request was not found'; end if;
  return true;
end;
$$;

create or replace function drift_contacts()
returns table(friend_user_id uuid, username text, discriminator text, handle text, avatar text, status text, requested_by uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select case when f.user_low = auth.uid() then f.user_high else f.user_low end,
         u.username, u.discriminator, u.username || '#' || u.discriminator,
         /* Prefer the picture the account actually set (Settings > profile),
            falling back to the legacy Drift-only avatar. */
         coalesce(nullif(p.avatar_url, ''), u.avatar_url),
         f.status, f.requested_by, f.created_at
  from drift_friendships f
  join drift_users u on u.user_id = case when f.user_low = auth.uid() then f.user_high else f.user_low end
  left join profiles p on p.id = u.user_id
  where auth.uid() is not null and auth.uid() in (f.user_low, f.user_high)
  order by f.created_at desc;
$$;

create or replace function drift_set_avatar(p_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare url text;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  url := coalesce(p_url, '');
  if char_length(url) > 300000 then raise exception 'image too large'; end if;
  if url <> '' and url !~ '^data:image/[a-zA-Z0-9.+-]+;base64,' then raise exception 'invalid image'; end if;
  update drift_users set avatar_url = url where user_id = auth.uid();
  if not found then raise exception 'open Drift once first'; end if;
  return true;
end;
$$;

create or replace function drift_messages_with(p_friend_user uuid, p_limit integer default 100)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare low_id uuid; high_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_friend_user is null or p_friend_user = auth.uid() then raise exception 'invalid friend'; end if;
  if auth.uid()::text < p_friend_user::text then low_id := auth.uid(); high_id := p_friend_user;
  else low_id := p_friend_user; high_id := auth.uid(); end if;
  if not exists (
    select 1 from drift_friendships f
    where f.user_low = low_id and f.user_high = high_id and f.status = 'accepted'
  ) then raise exception 'conversation is not available'; end if;
  return query
    select recent.id, recent.sender_id, recent.body, recent.created_at
    from (
      select m.id, m.sender_id, m.body, m.created_at
      from drift_messages m
      where m.user_low = low_id and m.user_high = high_id
      order by m.created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 200))
    ) recent
    order by recent.created_at asc;
end;
$$;

/* New incoming messages since a timestamp, for the "… has left you a
   message" notification. Only ever returns messages sent *to* the caller. */
create or replace function drift_incoming(p_since timestamptz default 'epoch')
returns table(id uuid, sender_id uuid, sender_username text, sender_discriminator text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.sender_id, u.username, u.discriminator, m.body, m.created_at
  from drift_messages m
  join drift_users u on u.user_id = m.sender_id
  where auth.uid() is not null
    and auth.uid() in (m.user_low, m.user_high)
    and m.sender_id <> auth.uid()
    and m.created_at > coalesce(p_since, 'epoch'::timestamptz)
  order by m.created_at desc
  limit 20;
$$;

revoke all on function drift_claim_username(text) from public, anon;
revoke all on function drift_set_avatar(text) from public, anon;
revoke all on function drift_request_friend(text) from public, anon;
revoke all on function drift_respond(uuid, boolean) from public, anon;
revoke all on function drift_contacts() from public, anon;
revoke all on function drift_messages_with(uuid, integer) from public, anon;
revoke all on function drift_incoming(timestamptz) from public, anon;
grant execute on function drift_claim_username(text) to authenticated;
grant execute on function drift_set_avatar(text) to authenticated;
grant execute on function drift_request_friend(text) to authenticated;
grant execute on function drift_respond(uuid, boolean) to authenticated;
grant execute on function drift_contacts() to authenticated;
grant execute on function drift_messages_with(uuid, integer) to authenticated;
grant execute on function drift_incoming(timestamptz) to authenticated;

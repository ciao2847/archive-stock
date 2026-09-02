create extension if not exists pgcrypto;

create type public.user_role as enum ('admin','staff');
create type public.product_status as enum ('in_stock','reserved','packing','packed','shipped');
create type public.order_status as enum ('pending','packing','packed','shipped','cancelled');

create sequence if not exists public.product_number_seq start 1;
create sequence if not exists public.order_number_seq start 1;
create sequence if not exists public.work_number_seq start 1;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.user_role not null default 'staff',
  created_at timestamptz not null default now()
);
create table public.works (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('MOV' || lpad(nextval('public.work_number_seq')::text,4,'0')),
  title_zh text not null, title_en text, title_ko text, title_ja text,
  release_year int, image_path text, created_at timestamptz not null default now()
);
create table public.locations (
  id uuid primary key default gen_random_uuid(), code text unique not null,
  cabinet text, shelf int, bin int, description text, created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null default ('A' || lpad(nextval('public.product_number_seq')::text,6,'0')),
  name text not null, category text not null, work_id uuid references public.works(id),
  country text, source text, location_id uuid references public.locations(id),
  stock int not null default 1 check(stock >= 0), status public.product_status not null default 'in_stock',
  cost numeric(12,2) not null default 0 check(cost >= 0),
  price numeric(12,2) not null default 0 check(price >= 0),
  notes text, image_paths text[] default '{}',
  poster_format text, poster_crafts text[] default '{}', poster_size text, style_name text,
  edition text, is_art_set boolean default false, release_date date, cinema text, identifying_features text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.location_movements (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
  from_location_id uuid references public.locations(id), to_location_id uuid not null references public.locations(id),
  moved_by uuid references public.profiles(id), moved_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(), name text not null, contact text, notes text, created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null default ('ORDER-' || lpad(nextval('public.order_number_seq')::text,6,'0')),
  customer_id uuid references public.customers(id), payment_status text not null default 'pending',
  status public.order_status not null default 'pending', notes text,
  packed_by uuid references public.profiles(id), packed_at timestamptz, shipped_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id), quantity int not null default 1 check(quantity > 0),
  scanned_quantity int not null default 0 check(scanned_quantity >= 0), unique(order_id,product_id)
);
create table public.packing_scans (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id), scanned_by uuid not null references public.profiles(id),
  is_valid boolean not null, scanned_at timestamptz not null default now()
);

create or replace function public.my_role() returns public.user_role language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid()
$$;
alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.location_movements enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.packing_scans enable row level security;

create policy "authenticated read profiles" on public.profiles for select to authenticated using(true);
create policy "admin manages profiles" on public.profiles for all to authenticated using(public.my_role()='admin') with check(public.my_role()='admin');
create policy "team reads works" on public.works for select to authenticated using(true);
create policy "team manages works" on public.works for all to authenticated using(true) with check(true);
create policy "team reads locations" on public.locations for select to authenticated using(true);
create policy "team manages locations" on public.locations for all to authenticated using(true) with check(true);
create policy "team reads products" on public.products for select to authenticated using(true);
create policy "team creates products" on public.products for insert to authenticated with check(true);
create policy "team updates products" on public.products for update to authenticated using(true) with check(true);
create policy "admin deletes products" on public.products for delete to authenticated using(public.my_role()='admin');
create policy "team movements" on public.location_movements for all to authenticated using(true) with check(true);
create policy "team customers" on public.customers for all to authenticated using(true) with check(true);
create policy "team orders" on public.orders for all to authenticated using(true) with check(true);
create policy "team order items" on public.order_items for all to authenticated using(true) with check(true);
create policy "team packing scans" on public.packing_scans for all to authenticated using(true) with check(true);

insert into storage.buckets(id,name,public) values('product-images','product-images',false) on conflict do nothing;
create policy "team reads product images" on storage.objects for select to authenticated using(bucket_id='product-images');
create policy "team uploads product images" on storage.objects for insert to authenticated with check(bucket_id='product-images');
create policy "admin deletes product images" on storage.objects for delete to authenticated using(bucket_id='product-images' and public.my_role()='admin');

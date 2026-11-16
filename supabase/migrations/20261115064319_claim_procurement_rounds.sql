begin;

-- Repeated procurement closes keep the order/payment ledger intact.
create table public.claim_procurement_rounds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  form_id bigint not null references public.claim_forms(id) on delete cascade,
  number integer not null check(number > 0),
  status text not null default 'open' check(status in ('open','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  request_id uuid,
  next_round_id uuid references public.claim_procurement_rounds(id),
  submission_count integer not null default 0 check(submission_count >= 0),
  customer_count integer not null default 0 check(customer_count >= 0),
  item_count bigint not null default 0 check(item_count >= 0),
  total_amount numeric(16,2) not null default 0 check(total_amount >= 0),
  unique(form_id,number), unique(form_id,request_id),
  check((status='open' and closed_at is null and request_id is null and next_round_id is null)
     or (status='closed' and closed_at is not null and request_id is not null and next_round_id is not null))
);
create unique index claim_procurement_one_open_idx on public.claim_procurement_rounds(form_id) where status='open';
create index claim_procurement_owner_form_idx on public.claim_procurement_rounds(owner_id,form_id,number desc);
create index claim_procurement_closed_by_idx on public.claim_procurement_rounds(closed_by);
create index claim_procurement_next_idx on public.claim_procurement_rounds(next_round_id);

-- Product UUIDs are historical identifiers, intentionally not a live-product FK.
-- Deleted/renamed products must never rewrite a closed procurement document.
create table public.claim_procurement_lines (
  round_id uuid not null references public.claim_procurement_rounds(id) on delete cascade,
  line_key text not null,
  product_id uuid,
  sku text not null, name text not null, ip text not null, craft text not null,
  quantity bigint not null check(quantity > 0),
  customer_count integer not null check(customer_count > 0),
  amount numeric(16,2) not null check(amount >= 0),
  primary key(round_id,line_key)
);
create table private.claim_procurement_memberships (
  submission_id bigint primary key references public.claim_submissions(id) on delete cascade,
  round_id uuid not null references public.claim_procurement_rounds(id) on delete cascade,
  owner_id uuid not null references public.inventory_databases(id) on delete cascade,
  form_id bigint not null references public.claim_forms(id) on delete cascade
);
create index claim_procurement_members_round_idx on private.claim_procurement_memberships(round_id,submission_id);
create index claim_procurement_members_owner_idx on private.claim_procurement_memberships(owner_id);
create index claim_procurement_members_form_idx on private.claim_procurement_memberships(form_id);

alter table public.claim_procurement_rounds enable row level security;
alter table public.claim_procurement_lines enable row level security;
alter table private.claim_procurement_memberships enable row level security;
revoke all on public.claim_procurement_rounds,public.claim_procurement_lines,private.claim_procurement_memberships from public,anon,authenticated;
grant select on public.claim_procurement_rounds,public.claim_procurement_lines to authenticated;
create policy procurement_round_read on public.claim_procurement_rounds for select to authenticated
 using(owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin');
create policy procurement_lines_read on public.claim_procurement_lines for select to authenticated
 using(exists(select 1 from public.claim_procurement_rounds r where r.id=round_id
   and (r.owner_id=(select private.current_inventory_owner_id()) or (select public.my_role())='admin')));

create function private.begin_claim_procurement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.claim_procurement_rounds(owner_id,form_id,number) values(new.owner_id,new.id,1);
 return new;
end $$;
create trigger claim_procurement_new_form after insert on public.claim_forms
 for each row execute function private.begin_claim_procurement();
insert into public.claim_procurement_rounds(owner_id,form_id,number)
 select owner_id,id,1 from public.claim_forms;
insert into private.claim_procurement_memberships(submission_id,round_id,owner_id,form_id)
 select s.id,r.id,r.owner_id,s.form_id from public.claim_submissions s
 join public.claim_procurement_rounds r on r.form_id=s.form_id and r.status='open';

create function private.assign_claim_procurement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.claim_forms where id=new.form_id for share;
 insert into private.claim_procurement_memberships(submission_id,round_id,owner_id,form_id)
 select new.id,r.id,r.owner_id,r.form_id from public.claim_procurement_rounds r
 where r.form_id=new.form_id and r.status='open';
 if not found then raise exception '找不到本期叫貨批次，請重新整理'; end if;
 return new;
end $$;
create trigger claim_procurement_assign after insert on public.claim_submissions
 for each row execute function private.assign_claim_procurement();

-- All edits share the same form lock. Close never locks source rows/products,
-- which avoids a reverse lock order with existing payment and fanmade RPCs.
create function private.lock_claim_procurement_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_old bigint; v_new bigint; begin
 if tg_table_name='claim_submissions' then
   if tg_op<>'INSERT' then v_old:=old.form_id; end if;
   if tg_op<>'DELETE' then v_new:=new.form_id; end if;
   if tg_op='UPDATE' and old.form_id is distinct from new.form_id then raise exception '訂購不可轉移至其他表單'; end if;
 elsif tg_table_name='claim_submission_items' then
   if tg_op<>'INSERT' then select form_id into v_old from public.claim_submissions where id=old.submission_id; end if;
   if tg_op<>'DELETE' then select form_id into v_new from public.claim_submissions where id=new.submission_id; end if;
 elsif tg_table_name='claim_submission_payments' then
   if tg_op<>'INSERT' then select form_id into v_old from public.claim_submissions where id=old.submission_id; end if;
   if tg_op<>'DELETE' then select form_id into v_new from public.claim_submissions where id=new.submission_id; end if;
 elsif tg_table_name='orders' then
   if tg_op<>'INSERT' then select form_id into v_old from public.claim_submissions where id=old.claim_submission_id; end if;
   if tg_op<>'DELETE' then select form_id into v_new from public.claim_submissions where id=new.claim_submission_id; end if;
 end if;
 perform 1 from public.claim_forms where id in(v_old,v_new) order by id for share;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger claim_procurement_source_lock before update or delete on public.claim_submissions
 for each row execute function private.lock_claim_procurement_source();
create trigger claim_procurement_item_lock before insert or update or delete on public.claim_submission_items
 for each row execute function private.lock_claim_procurement_source();
create trigger claim_procurement_payment_lock before insert or update or delete on public.claim_submission_payments
 for each row execute function private.lock_claim_procurement_source();
create trigger claim_procurement_order_lock before update or delete on public.orders
 for each row execute function private.lock_claim_procurement_source();

create function private.guard_procurement_form_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if pg_trigger_depth()<=1 and exists(select 1 from public.claim_procurement_rounds where form_id=old.id and status='closed') then
   raise exception '表單已有結單紀錄，請改為暫停接單以保留歷史';
 end if;
 return old;
end $$;
create trigger claim_procurement_keep_history before delete on public.claim_forms
 for each row execute function private.guard_procurement_form_delete();

-- One SQL snapshot computes paid readiness and all immutable item totals.
-- Payment events override manual labels, just as the existing customer ledger.
create function private.claim_procurement_payload(p_round_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with sources as materialized (
   select s.id,s.phone_normalized,
     case when pay.count>0 then pay.amount>=items.amount else s.payment_status='paid' end as is_paid
   from private.claim_procurement_memberships m join public.claim_submissions s on s.id=m.submission_id
   cross join lateral(select coalesce(sum(i.quantity*i.unit_price),0) amount from public.claim_submission_items i where i.submission_id=s.id) items
   cross join lateral(select count(*) count,coalesce(sum(p.amount),0) amount from public.claim_submission_payments p where p.submission_id=s.id) pay
   where m.round_id=p_round_id and not exists(select 1 from public.orders o where o.claim_submission_id=s.id and (o.deleted_at is not null or o.status='cancelled'))
 ), paid as materialized(select * from sources where is_paid),
 lines as (
   select coalesce(i.product_id::text,'sku:'||i.product_sku) line_key,
    i.product_id,(array_agg(i.product_sku order by i.id desc))[1] sku,
    (array_agg(i.product_name order by i.id desc))[1] name,
    coalesce(w.title_zh,'') ip,coalesce(d.craft,array_to_string(p.poster_crafts,'／'),'') craft,
    sum(i.quantity)::bigint quantity,count(distinct s.phone_normalized)::integer customer_count,
    sum(i.quantity*i.unit_price) amount
   from paid s join public.claim_submission_items i on i.submission_id=s.id
   left join public.products p on p.id=i.product_id left join public.works w on w.id=p.work_id
   left join public.fanmade_details d on d.product_id=i.product_id
   group by coalesce(i.product_id::text,'sku:'||i.product_sku),i.product_id,w.title_zh,d.craft,p.poster_crafts
 )
 select jsonb_build_object(
  'submissionCount',(select count(*) from sources),
  'paidSubmissionCount',(select count(*) from paid),
  'unpaidSubmissionCount',(select count(*) from sources where not is_paid),
  'customerCount',(select count(distinct phone_normalized) from paid),
  'itemCount',coalesce((select sum(quantity) from lines),0),
  'totalAmount',coalesce((select sum(amount) from lines),0),
  'paidIds',coalesce((select jsonb_agg(id) from paid),'[]'),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineKey',line_key,'productId',product_id,'sku',sku,'name',name,'ip',ip,'craft',craft,'quantity',quantity,'customerCount',customer_count,'amount',amount) order by ip,name,craft,sku) from lines),'[]')
 );
$$;

create function private.get_claim_procurement(p_owner_id uuid,p_form_id bigint,p_round_id uuid,p_history_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_round public.claim_procurement_rounds%rowtype; selected_round public.claim_procurement_rounds%rowtype;
 v_payload jsonb; v_selected jsonb; v_history jsonb; begin
 if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then raise exception using errcode='42501',message='employee access required'; end if;
 if p_owner_id is null or ((select public.my_role())<>'admin' and p_owner_id is distinct from (select private.current_inventory_owner_id())) then raise exception using errcode='42501',message='owner access required'; end if;
 if p_history_page is null or p_history_page not between 1 and 10000 then raise exception using errcode='22023',message='invalid history page'; end if;
 if not exists(select 1 from public.claim_forms where id=p_form_id and owner_id=p_owner_id) then raise exception using errcode='P0002',message='claim form not found'; end if;
 select * into current_round from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and status='open';
 if not found then raise exception '請先安裝結單批次 migration'; end if;
 v_payload:=private.claim_procurement_payload(current_round.id);
 select * into selected_round from public.claim_procurement_rounds where id=coalesce(p_round_id,current_round.id) and form_id=p_form_id and owner_id=p_owner_id;
 if not found then raise exception using errcode='P0002',message='procurement round not found'; end if;
 if selected_round.status='open' then
   v_selected:=jsonb_build_object('id',selected_round.id,'number',selected_round.number,'status','open','createdAt',selected_round.created_at,'closedAt',null,
    'submissionCount',v_payload->'paidSubmissionCount','customerCount',v_payload->'customerCount','itemCount',v_payload->'itemCount','totalAmount',v_payload->'totalAmount',
    'lines',coalesce((select jsonb_agg(x-'lineKey') from jsonb_array_elements(v_payload->'lines') x),'[]'));
 else
   v_selected:=jsonb_build_object('id',selected_round.id,'number',selected_round.number,'status','closed','createdAt',selected_round.created_at,'closedAt',selected_round.closed_at,
    'submissionCount',selected_round.submission_count,'customerCount',selected_round.customer_count,'itemCount',selected_round.item_count,'totalAmount',selected_round.total_amount,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('productId',l.product_id,'sku',l.sku,'name',l.name,'ip',l.ip,'craft',l.craft,'quantity',l.quantity,'customerCount',l.customer_count,'amount',l.amount) order by l.ip,l.name,l.craft,l.sku) from public.claim_procurement_lines l where l.round_id=selected_round.id),'[]'));
 end if;
 select coalesce(jsonb_agg(x.item order by x.number desc),'[]') into v_history from(
  select number,jsonb_build_object('id',id,'number',number,'closedAt',closed_at,'submissionCount',submission_count,'itemCount',item_count,'totalAmount',total_amount) item
  from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and status='closed' order by number desc limit 12 offset (p_history_page-1)*12
 )x;
 return jsonb_build_object('current',jsonb_build_object('id',current_round.id,'number',current_round.number,'submissionCount',v_payload->'submissionCount','paidSubmissionCount',v_payload->'paidSubmissionCount','unpaidSubmissionCount',v_payload->'unpaidSubmissionCount','itemCount',v_payload->'itemCount','totalAmount',v_payload->'totalAmount'),
 'selected',v_selected,'history',v_history,'historyHasMore',(select count(*)>p_history_page*12 from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and status='closed'));
end $$;

create function private.close_claim_procurement(p_owner_id uuid,p_form_id bigint,p_round_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.claim_procurement_rounds%rowtype; v_payload jsonb; v_next uuid; begin
 if (select auth.uid()) is null or coalesce((select public.my_role())::text,'') not in ('admin','staff') then raise exception using errcode='42501',message='employee access required'; end if;
 if p_owner_id is null or ((select public.my_role())<>'admin' and p_owner_id is distinct from (select private.current_inventory_owner_id())) then raise exception using errcode='42501',message='owner access required'; end if;
 if p_round_id is null or p_request_id is null then raise exception using errcode='22023',message='invalid close request'; end if;
 perform 1 from public.claim_forms where id=p_form_id and owner_id=p_owner_id for update;
 if not found then raise exception using errcode='P0002',message='claim form not found'; end if;
 select * into r from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and request_id=p_request_id;
 if found then
  if r.id<>p_round_id then raise exception using errcode='22023',message='同一結單請求不可套用其他期別'; end if;
  return jsonb_build_object('closedRoundId',r.id,'nextRoundId',r.next_round_id);
 end if;
 select * into r from public.claim_procurement_rounds where id=p_round_id and form_id=p_form_id and owner_id=p_owner_id and status='open';
 if not found then raise exception using errcode='22023',message='此期已結單或已更新，請重新載入'; end if;
 v_payload:=private.claim_procurement_payload(r.id);
 if coalesce((v_payload->>'itemCount')::bigint,0)=0 then raise exception using errcode='22000',message='目前沒有已付款的有效商品可結單'; end if;
 -- Only membership changes; do not UPDATE claim_submissions and reproject orders.
 update public.claim_procurement_rounds set status='closed',closed_at=clock_timestamp(),closed_by=(select auth.uid()),request_id=p_request_id,
  next_round_id=id,submission_count=(v_payload->>'paidSubmissionCount')::integer,customer_count=(v_payload->>'customerCount')::integer,
  item_count=(v_payload->>'itemCount')::bigint,total_amount=(v_payload->>'totalAmount')::numeric where id=r.id;
 insert into public.claim_procurement_rounds(owner_id,form_id,number) values(p_owner_id,p_form_id,r.number+1) returning id into v_next;
 update public.claim_procurement_rounds set next_round_id=v_next where id=r.id;
 insert into public.claim_procurement_lines(round_id,line_key,product_id,sku,name,ip,craft,quantity,customer_count,amount)
 select r.id,x."lineKey",x."productId",x.sku,x.name,x.ip,x.craft,x.quantity,x."customerCount",x.amount
 from jsonb_to_recordset(v_payload->'lines') as x("lineKey" text,"productId" uuid,sku text,name text,ip text,craft text,quantity bigint,"customerCount" integer,amount numeric);
 update private.claim_procurement_memberships set round_id=v_next where round_id=r.id
 and submission_id not in(select value::bigint from jsonb_array_elements_text(v_payload->'paidIds'));
 return jsonb_build_object('closedRoundId',r.id,'nextRoundId',v_next);
end $$;

create function public.get_claim_procurement(p_owner_id uuid,p_form_id bigint,p_round_id uuid default null,p_history_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.get_claim_procurement(p_owner_id,p_form_id,p_round_id,p_history_page);
$$;
create function public.close_claim_procurement(p_owner_id uuid,p_form_id bigint,p_round_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.close_claim_procurement(p_owner_id,p_form_id,p_round_id,p_request_id);
$$;
revoke all on function private.begin_claim_procurement(),private.assign_claim_procurement(),private.lock_claim_procurement_source(),private.guard_procurement_form_delete(),private.claim_procurement_payload(uuid) from public,anon,authenticated;
revoke all on function private.get_claim_procurement(uuid,bigint,uuid,integer),private.close_claim_procurement(uuid,bigint,uuid,uuid),public.get_claim_procurement(uuid,bigint,uuid,integer),public.close_claim_procurement(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_claim_procurement(uuid,bigint,uuid,integer),private.close_claim_procurement(uuid,bigint,uuid,uuid),public.get_claim_procurement(uuid,bigint,uuid,integer),public.close_claim_procurement(uuid,bigint,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

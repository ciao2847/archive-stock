begin;

-- Add four per-product counters to each selected batch without changing the
-- paid-only close payload, memberships, stock or historical procurement lines.
create or replace function private.claim_procurement_payload(p_round_id uuid) returns jsonb
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
 ), product_totals as (
   -- All valid members belong to this batch; only fully paid members can close.
   -- Reuse sources.is_paid so payments and cancellation handling match paid lines.
   select coalesce(i.product_id::text,'sku:'||i.product_sku) line_key,
    i.product_id,(array_agg(i.product_sku order by i.id desc))[1] sku,
    (array_agg(i.product_name order by i.id desc))[1] name,
    coalesce(w.title_zh,'') ip,coalesce(d.craft,array_to_string(p.poster_crafts,'／'),'') craft,
    sum(i.quantity)::bigint quantity,
    coalesce(sum(i.quantity) filter(where s.is_paid),0)::bigint paid_quantity,
    count(distinct s.phone_normalized)::integer customer_count
   from sources s join public.claim_submission_items i on i.submission_id=s.id
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
  'productTotals',coalesce((select jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'name',name,'ip',ip,'craft',craft,'quantity',quantity,'paidQuantity',paid_quantity,'customerCount',customer_count) order by ip,name,craft,sku) from product_totals),'[]'),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineKey',line_key,'productId',product_id,'sku',sku,'name',name,'ip',ip,'craft',craft,'quantity',quantity,'customerCount',customer_count,'amount',amount) order by ip,name,craft,sku) from lines),'[]')
 );
$$;

create or replace function private.get_claim_procurement(p_owner_id uuid,p_form_id bigint,p_round_id uuid,p_history_page integer)
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
    'productTotals',v_payload->'productTotals',
    'lines',coalesce((select jsonb_agg(x-'lineKey') from jsonb_array_elements(v_payload->'lines') x),'[]'));
 else
   v_selected:=jsonb_build_object('id',selected_round.id,'number',selected_round.number,'status','closed','createdAt',selected_round.created_at,'closedAt',selected_round.closed_at,
    'submissionCount',selected_round.submission_count,'customerCount',selected_round.customer_count,'itemCount',selected_round.item_count,'totalAmount',selected_round.total_amount,
    -- Closed batches only contain the paid, immutable procurement snapshot.
    -- Do not read source memberships: unpaid orders have moved to the next batch.
    'productTotals',coalesce((select jsonb_agg(jsonb_build_object('productId',l.product_id,'sku',l.sku,'name',l.name,'ip',l.ip,'craft',l.craft,'quantity',l.quantity,'paidQuantity',l.quantity,'customerCount',l.customer_count) order by l.ip,l.name,l.craft,l.sku) from public.claim_procurement_lines l where l.round_id=selected_round.id),'[]'),
    'lines',coalesce((select jsonb_agg(jsonb_build_object('productId',l.product_id,'sku',l.sku,'name',l.name,'ip',l.ip,'craft',l.craft,'quantity',l.quantity,'customerCount',l.customer_count,'amount',l.amount) order by l.ip,l.name,l.craft,l.sku) from public.claim_procurement_lines l where l.round_id=selected_round.id),'[]'));
 end if;
 select coalesce(jsonb_agg(x.item order by x.number desc),'[]') into v_history from(
  select number,jsonb_build_object('id',id,'number',number,'closedAt',closed_at,'submissionCount',submission_count,'itemCount',item_count,'totalAmount',total_amount) item
  from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and status='closed' order by number desc limit 12 offset (p_history_page-1)*12
 )x;
 return jsonb_build_object('current',jsonb_build_object('id',current_round.id,'number',current_round.number,'submissionCount',v_payload->'submissionCount','paidSubmissionCount',v_payload->'paidSubmissionCount','unpaidSubmissionCount',v_payload->'unpaidSubmissionCount','itemCount',v_payload->'itemCount','totalAmount',v_payload->'totalAmount','productTotals',v_payload->'productTotals'),
 'selected',v_selected,'history',v_history,'historyHasMore',(select count(*)>p_history_page*12 from public.claim_procurement_rounds where form_id=p_form_id and owner_id=p_owner_id and status='closed'));
end $$;

-- Reassert the existing least-privilege grants after replacing function bodies.
revoke all on function private.claim_procurement_payload(uuid) from public,anon,authenticated;
revoke all on function private.get_claim_procurement(uuid,bigint,uuid,integer) from public,anon,authenticated;
grant execute on function private.get_claim_procurement(uuid,bigint,uuid,integer) to authenticated;

notify pgrst,'reload schema';
commit;

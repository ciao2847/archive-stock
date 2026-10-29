begin;

-- North America is a region; use a globe instead of an individual country flag.
create or replace function public.format_preorder_product_name(p_country text, p_work text, p_item_name text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_flag text;
  v_work text := btrim(regexp_replace(btrim(coalesce(p_work,'')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_item text := btrim(regexp_replace(btrim(coalesce(p_item_name,'')), '^([🇦-🇿]{2}[[:space:]]*)+', ''));
  v_name text;
begin
  v_flag := case btrim(p_country)
    when '韓國' then '🇰🇷' when '日本' then '🇯🇵' when '台灣' then '🇹🇼'
    when '香港' then '🇭🇰' when '大陸' then '🇨🇳'
    when '馬來西亞' then '🇲🇾' when '北美' then '🌎' else null end;
  if v_flag is null then raise exception '請選擇國家版本'; end if;
  if v_work = '' or char_length(v_work) > 200 or char_length(v_item) > 200 then
    raise exception '請填寫作品名稱，作品與品項名稱各限 200 字元';
  end if;
  v_name := v_flag || ' ' || v_work || case when v_item = '' then '' else ' ' || v_item end;
  if char_length(v_name) > 300 then raise exception '組合後的商品名稱最多 300 字元'; end if;
  return v_name;
end;
$$;

notify pgrst, 'reload schema';
commit;

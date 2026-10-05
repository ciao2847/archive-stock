begin;

-- Preserve the transfer account that the LINE webhook previously embedded in
-- code, but store it on the matching inventory so future changes are managed
-- through System Settings instead of requiring a deployment.
update public.inventory_databases
set
  claim_transfer_enabled = true,
  claim_bank_code = coalesce(nullif(btrim(claim_bank_code), ''), '824'),
  claim_bank_name = coalesce(
    nullif(btrim(claim_bank_name), ''),
    '連線商業銀行 (LINE Bank)'
  ),
  claim_bank_account = '111022318292',
  claim_bank_account_name = coalesce(
    nullif(btrim(claim_bank_account_name), ''),
    '海報小天地'
  ),
  updated_at = now()
where id = '96732d7f-27ba-480a-9f41-c3ea131d0c06'::uuid
  and official_line_id = '@xhs4077g'
  and nullif(btrim(claim_bank_account), '') is null;

commit;

-- save_board 的 RETURNS TABLE 会创建同名 PL/pgSQL 输出变量。
-- 未限定的 board_id 因此会与 board_assets.board_id 产生歧义。
do $migration$
declare
  v_signature constant regprocedure := 'public.save_board(uuid, bigint, jsonb, jsonb, text)'::regprocedure;
  v_definition text;
  v_broken_statement constant text :=
    'delete from public.board_assets where board_id = p_board_id;';
  v_fixed_statement constant text :=
    'delete from public.board_assets as existing_asset where existing_asset.board_id = p_board_id;';
begin
  select pg_catalog.pg_get_functiondef(v_signature::oid)
  into strict v_definition;

  if pg_catalog.strpos(v_definition, v_broken_statement) = 0 then
    raise exception 'save_board definition no longer contains the expected statement';
  end if;

  execute pg_catalog.replace(v_definition, v_broken_statement, v_fixed_statement);
end;
$migration$;

-- PostgreSQL 的 COALESCE/LEAST 是特殊 SQL 表达式，不能使用 schema 限定名。
-- 初始迁移将它们写成 pg_catalog.coalesce/least，导致画板 RPC 在执行时以 42883 失败。
-- 这里保留已部署函数的完整定义与权限，只替换无效的限定写法。
do $migration$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.create_board(text)'::regprocedure,
    'public.rename_board(uuid, text)'::regprocedure,
    'public.save_board(uuid, bigint, jsonb, jsonb, text)'::regprocedure,
    'public.delete_board(uuid)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_signature::oid)
    into strict v_definition;

    v_definition := pg_catalog.replace(v_definition, 'pg_catalog.coalesce', 'coalesce');
    v_definition := pg_catalog.replace(v_definition, 'pg_catalog.least', 'least');
    execute v_definition;
  end loop;
end;
$migration$;

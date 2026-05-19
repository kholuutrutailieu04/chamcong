-- ChamCong Supabase security audit export
-- Supabase SQL Editor often shows only the last result set when a script has
-- many SELECT statements. This version returns one combined result set.

with
business_tables as (
  select
    '01_business_tables'::text as section,
    table_name::text as item,
    to_jsonb(t) as payload
  from (
    select
      table_schema,
      table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name in (
        'bang_truc_noi_bo',
        'cau_hinh_ca_truc',
        'cau_hinh_he_thong',
        'co_so',
        'dm_khoa_phong',
        'dm_khoa_phong_emails',
        'don_nghi_phep',
        'kiem_tra_dot_xuat',
        'image_sync_jobs',
        'lich_luan_chuyen',
        'lich_nghi_bu',
        'lich_su_cham_cong',
        'lich_su_sua_nham_cham_cong',
        'log_gian_lan',
        'ngay_le',
        'nhan_vien',
        'thiet_bi_nhan_vien',
        'yeu_cau_quan_tri'
      )
  ) t
),
table_grants as (
  select
    '02_table_grants'::text as section,
    (table_name || ':' || grantee || ':' || privilege_type)::text as item,
    to_jsonb(t) as payload
  from (
    select
      table_schema,
      table_name,
      grantee,
      privilege_type
    from information_schema.table_privileges
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated', 'service_role')
  ) t
),
sequence_grants as (
  select
    '03_sequence_grants'::text as section,
    (object_name || ':' || grantee || ':' || privilege_type)::text as item,
    to_jsonb(t) as payload
  from (
    select
      object_schema,
      object_name,
      grantee,
      privilege_type
    from information_schema.usage_privileges
    where object_schema = 'public'
      and object_type = 'SEQUENCE'
      and grantee in ('anon', 'authenticated', 'service_role')
  ) t
),
rls_state as (
  select
    '04_rls_state'::text as section,
    tablename::text as item,
    to_jsonb(t) as payload
  from (
    select
      n.nspname as schemaname,
      c.relname as tablename,
      c.relrowsecurity as rowsecurity,
      c.relforcerowsecurity as forcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ) t
),
policies as (
  select
    '05_policies'::text as section,
    (tablename || ':' || policyname)::text as item,
    to_jsonb(t) as payload
  from (
    select
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
  ) t
),
function_signatures as (
  select
    '06_function_signatures'::text as section,
    (function_name || '(' || identity_arguments || ')')::text as item,
    to_jsonb(t) as payload
  from (
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_result(p.oid) as result_type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'process_rotation_timeline'
  ) t
),
function_grants as (
  select
    '07_function_grants'::text as section,
    (routine_name || ':' || grantee || ':' || privilege_type)::text as item,
    to_jsonb(t) as payload
  from (
    select
      routine_schema,
      routine_name,
      grantee,
      privilege_type
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'process_rotation_timeline'
      and grantee in ('anon', 'authenticated', 'service_role')
  ) t
),
auth_columns as (
  select
    '08_auth_columns'::text as section,
    column_name::text as item,
    to_jsonb(t) as payload
  from (
    select
      column_name,
      data_type,
      is_nullable,
      column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dm_khoa_phong_emails'
      and column_name in (
        'email',
        'ma_khoa',
        'ho_ten',
        'trang_thai',
        'mat_khau',
        'role',
        'password_changed_at',
        'last_login_at',
        'failed_login_count',
        'locked_until',
        'session_version'
      )
  ) t
),
storage_buckets as (
  select
    '09_storage_buckets'::text as section,
    name::text as item,
    to_jsonb(t) as payload
  from (
    select
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    from storage.buckets
  ) t
)
select section, item, payload
from business_tables
union all
select section, item, payload from table_grants
union all
select section, item, payload from sequence_grants
union all
select section, item, payload from rls_state
union all
select section, item, payload from policies
union all
select section, item, payload from function_signatures
union all
select section, item, payload from function_grants
union all
select section, item, payload from auth_columns
union all
select section, item, payload from storage_buckets
order by section, item;

-- ChamCong Supabase security audit
-- Run in Supabase SQL Editor before any production grant/RLS change.
-- Save the full output with the execution date.

-- 1. Confirm business tables exist.
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
order by table_name;

-- 2. Current table grants for API roles.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 3. Current sequence grants for API roles.
select
  object_schema,
  object_name,
  grantee,
  privilege_type
from information_schema.usage_privileges
where object_schema = 'public'
  and object_type = 'SEQUENCE'
  and grantee in ('anon', 'authenticated', 'service_role')
order by object_name, grantee, privilege_type;

-- 4. RLS state.
select
  n.nspname as schemaname,
  c.relname as tablename,
  c.relrowsecurity as rowsecurity,
  c.relforcerowsecurity as forcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 5. Existing RLS policies.
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
order by tablename, policyname;

-- 6. Function signatures and execute grants.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'process_rotation_timeline'
order by function_name, identity_arguments;

select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'process_rotation_timeline'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- 7. Auth table columns expected by the security artifact.
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
order by ordinal_position;

-- 8. Storage bucket visibility. Requires access to the storage schema.
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
order by name;

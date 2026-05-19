-- ChamCong Supabase security rollback
-- Use only as a temporary production recovery script if the app breaks.
-- This reopens the minimum direct grants that the old browser flows used.
-- Prefer fixing API/session code and reapplying database/supabase-security/apply.sql.

-- Rollback Block 1. Reopen previous browser direct reads for legacy screens.
grant select on table
  public.nhan_vien,
  public.yeu_cau_quan_tri
to anon, authenticated;

-- Rollback Block 2. Reopen catalog reads only if geofence/catalog screens fail.
grant select on table
  public.co_so,
  public.dm_khoa_phong,
  public.cau_hinh_ca_truc,
  public.ngay_le
to anon, authenticated;

-- Rollback Block 3. Reopen function execution only if a legacy client directly
-- calls this RPC. Current ChamCong API should use service_role server-side.
grant execute on function public.process_rotation_timeline(character varying, character varying, date, date)
to anon, authenticated;

grant execute on function public.process_rotation_timeline(character varying, character varying, date, date, character varying)
to anon, authenticated;

grant execute on function public.process_rotation_timeline(text, text, date, date, text)
to anon, authenticated;

-- Rollback Block 4. Recreate old permissive read policies only if emergency
-- rollback reopens legacy browser reads and the app is still broken.
-- These are intentionally commented because they expose sensitive data.
-- create policy "Enable read access for all users"
--   on public.nhan_vien
--   for select
--   to public
--   using (true);
--
-- create policy "Enable read access for all users"
--   on public.lich_su_cham_cong
--   for select
--   to public
--   using (true);
--
-- create policy "Enable SELECT for anon role on real data"
--   on public.lich_su_cham_cong
--   for select
--   to anon
--   using (((is_test = false) or true));
--
-- create policy "anon_doc_ban_ghi_cua_chinh_minh"
--   on public.lich_su_cham_cong
--   for select
--   to anon
--   using (true);

-- Rollback Block 5. Do not disable RLS by default.
-- If emergency rollback absolutely requires it, run only the specific table line
-- after documenting the incident:
-- alter table public.nhan_vien disable row level security;
-- alter table public.yeu_cau_quan_tri disable row level security;

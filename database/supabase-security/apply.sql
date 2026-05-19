-- ChamCong Supabase security apply script
-- Production rule: run one numbered block at a time, then test the app.
-- Do not run this before saving database/supabase-security/audit.sql output.

-- Tables governed by the server-only data policy:
-- public.bang_truc_noi_bo
-- public.cau_hinh_ca_truc
-- public.cau_hinh_he_thong
-- public.co_so
-- public.dm_khoa_phong
-- public.dm_khoa_phong_emails
-- public.don_nghi_phep
-- public.kiem_tra_dot_xuat
-- public.image_sync_jobs
-- public.lich_luan_chuyen
-- public.lich_nghi_bu
-- public.lich_su_cham_cong
-- public.lich_su_sua_nham_cham_cong
-- public.log_gian_lan
-- public.ngay_le
-- public.nhan_vien
-- public.thiet_bi_nhan_vien
-- public.yeu_cau_quan_tri

-- Block 1. Do not auto-expose newly created public tables/sequences.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

-- Block 2. Explicitly allow server-side service_role access.
grant select, insert, update, delete on table
  public.bang_truc_noi_bo,
  public.cau_hinh_ca_truc,
  public.cau_hinh_he_thong,
  public.co_so,
  public.dm_khoa_phong,
  public.dm_khoa_phong_emails,
  public.don_nghi_phep,
  public.kiem_tra_dot_xuat,
  public.image_sync_jobs,
  public.lich_luan_chuyen,
  public.lich_nghi_bu,
  public.lich_su_cham_cong,
  public.lich_su_sua_nham_cham_cong,
  public.log_gian_lan,
  public.ngay_le,
  public.nhan_vien,
  public.thiet_bi_nhan_vien,
  public.yeu_cau_quan_tri
to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Block 3. Close direct table/sequence access for browser-facing API roles.
revoke all on table
  public.bang_truc_noi_bo,
  public.cau_hinh_ca_truc,
  public.cau_hinh_he_thong,
  public.co_so,
  public.dm_khoa_phong,
  public.dm_khoa_phong_emails,
  public.don_nghi_phep,
  public.kiem_tra_dot_xuat,
  public.image_sync_jobs,
  public.lich_luan_chuyen,
  public.lich_nghi_bu,
  public.lich_su_cham_cong,
  public.lich_su_sua_nham_cham_cong,
  public.log_gian_lan,
  public.ngay_le,
  public.nhan_vien,
  public.thiet_bi_nhan_vien,
  public.yeu_cau_quan_tri
from anon, authenticated;

revoke usage, select on all sequences in schema public from anon, authenticated;

-- Block 4. Enable RLS as defense in depth.
alter table public.bang_truc_noi_bo enable row level security;
alter table public.cau_hinh_ca_truc enable row level security;
alter table public.cau_hinh_he_thong enable row level security;
alter table public.co_so enable row level security;
alter table public.dm_khoa_phong enable row level security;
alter table public.dm_khoa_phong_emails enable row level security;
alter table public.don_nghi_phep enable row level security;
alter table public.kiem_tra_dot_xuat enable row level security;
alter table public.image_sync_jobs enable row level security;
alter table public.lich_luan_chuyen enable row level security;
alter table public.lich_nghi_bu enable row level security;
alter table public.lich_su_cham_cong enable row level security;
alter table public.lich_su_sua_nham_cham_cong enable row level security;
alter table public.log_gian_lan enable row level security;
alter table public.ngay_le enable row level security;
alter table public.nhan_vien enable row level security;
alter table public.thiet_bi_nhan_vien enable row level security;
alter table public.yeu_cau_quan_tri enable row level security;

-- Block 4b. Remove browser-facing permissive policies from the old direct
-- Supabase client model. With the new architecture, Next.js API is the only
-- data gate, and service_role is server-side only.
drop policy if exists "Enable SELECT for anon role on real data" on public.lich_su_cham_cong;
drop policy if exists "Enable read access for all users" on public.lich_su_cham_cong;
drop policy if exists "anon_doc_ban_ghi_cua_chinh_minh" on public.lich_su_cham_cong;
drop policy if exists "Enable read access for all users" on public.nhan_vien;

-- Block 5. Restrict function/RPC execution to service_role.
-- Audit found three overloads. Restrict all of them.
grant execute on function public.process_rotation_timeline(character varying, character varying, date, date) to service_role;
grant execute on function public.process_rotation_timeline(character varying, character varying, date, date, character varying) to service_role;
grant execute on function public.process_rotation_timeline(text, text, date, date, text) to service_role;

revoke execute on function public.process_rotation_timeline(character varying, character varying, date, date) from anon, authenticated;
revoke execute on function public.process_rotation_timeline(character varying, character varying, date, date, character varying) from anon, authenticated;
revoke execute on function public.process_rotation_timeline(text, text, date, date, text) from anon, authenticated;

-- Block 6. Auth hardening columns for dm_khoa_phong_emails.
-- Run only after you have the ADMIN/TCCB email list ready.
-- Decision: one email is one account row. ADMIN/TCCB can also carry ma_khoa
-- when that same account needs to use the Manager dashboard for a department.
alter table public.dm_khoa_phong_emails
  add column if not exists role text not null default 'MANAGER',
  add column if not exists password_changed_at timestamptz,
  add column if not exists last_login_at timestamptz,
  add column if not exists failed_login_count integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists session_version integer not null default 1;

alter table public.dm_khoa_phong_emails
  alter column ma_khoa drop not null;

update public.dm_khoa_phong_emails
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dm_khoa_phong_emails_role_check'
      and conrelid = 'public.dm_khoa_phong_emails'::regclass
  ) then
    alter table public.dm_khoa_phong_emails
      add constraint dm_khoa_phong_emails_role_check
      check (role in ('ADMIN', 'TCCB', 'MANAGER'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dm_khoa_phong_emails_role_ma_khoa_check'
      and conrelid = 'public.dm_khoa_phong_emails'::regclass
  ) then
    alter table public.dm_khoa_phong_emails
      add constraint dm_khoa_phong_emails_role_ma_khoa_check
      check (
        (role = 'MANAGER' and ma_khoa is not null)
        or (role in ('ADMIN', 'TCCB'))
      );
  end if;
end $$;

create unique index if not exists dm_khoa_phong_emails_email_lower_uidx
  on public.dm_khoa_phong_emails (lower(email));

-- Block 7. Manual role mapping placeholder.
-- Replace the emails before running this block.
-- update public.dm_khoa_phong_emails
-- set role = 'TCCB', ma_khoa = null
-- where lower(email) in ('tccb@example.vn');

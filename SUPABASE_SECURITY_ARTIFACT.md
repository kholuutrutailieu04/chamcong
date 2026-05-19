# Supabase Security Artifact - ChamCong

Ngày lập: 2026-05-18

Nguồn tham chiếu: Supabase discussion #45329 - "Breaking Change: Tables not exposed to Data and GraphQL API automatically".

## 1. Quyết Định Đã Chốt

Các quyết định mới của dự án:

1. Toàn bộ dữ liệu nghiệp vụ đi qua API Next.js, không để trình duyệt gọi trực tiếp bảng Supabase.
2. Giữ `dm_khoa_phong_emails` làm bảng auth chính cho Admin/TCCB và Manager; không tách bảng auth mới về sau.
3. Dùng session token server-side cho Admin/TCCB, Manager và Employee.
4. Không có Supabase staging/test, nên migration production phải đi theo hướng audit trước, chạy từng block nhỏ, có rollback script.
5. Phân nhóm bảo mật cần mạnh hơn bản đầu: mặc định mọi bảng server-only; chỉ mở Data API cho `service_role`, không mở `anon/authenticated` cho bảng gốc.

Kết luận chốt:

- Browser không đọc/ghi trực tiếp Supabase table bằng anon key.
- Next.js API là cổng dữ liệu duy nhất.
- `service_role` chỉ tồn tại server-side.
- `anon` có thể vẫn dùng cho Supabase Auth OTP nếu cần, nhưng không có quyền đọc/ghi bảng nghiệp vụ.
- RLS vẫn bật để phòng thủ, nhưng phân quyền thật ở lớp API server vì `service_role` bypass RLS.

## 2. Ý Nghĩa Update Supabase #45329

Supabase thay đổi mặc định Data API:

- Bảng mới trong schema `public` sẽ không tự expose qua Data API/GraphQL nếu thiếu `GRANT` explicit.
- `GRANT` và RLS là hai lớp khác nhau:
  - `GRANT` quyết định role có vào được bảng qua Data API hay không.
  - RLS quyết định role đó được thấy dòng nào.
- Nếu thiếu `GRANT`, PostgREST trả lỗi permission trước khi RLS chạy.
- Migrations nên luôn có đủ `GRANT`, `ENABLE ROW LEVEL SECURITY`, policy hoặc quyết định không tạo policy.

Với ChamCong, ta tận dụng thay đổi này để đóng Data API mặc định, tránh lộ bảng mới do tạo nhầm.

## 3. Báo Cáo Đối Chiếu Code Hiện Tại

Hiện trạng code:

- `src/lib/supabase.ts` có `supabase` dùng anon key và `getAdminClient()` dùng `service_role`.
- Nhiều API trong `src/app/api/**` dùng `getAdminClient()`.
- Browser hiện còn gọi Supabase trực tiếp ở:
  - `src/app/attendance/page.tsx`: đọc `nhan_vien`.
  - `src/app/admin/page.tsx`: đọc `yeu_cau_quan_tri`.
  - `src/app/manager/page.tsx`: dùng realtime channel.
- Admin và Manager hiện lưu session trong `sessionStorage`.
- Một số API tin vào `khoa`, `manager_email`, `x-user-email`, `ma_nv` từ client.
- Repo chưa có migration SQL versioned cho grants/RLS/policies.

Mâu thuẫn/rủi ro:

- Nếu chỉ bật RLS nhưng API vẫn dùng `service_role`, RLS không chặn được lỗi phân quyền trong API.
- Nếu browser còn gọi bảng bằng anon key, các bảng có `email`, `so_dien_thoai`, `device_id`, `token`, link ảnh hoặc mật khẩu hash có nguy cơ lộ.
- Nếu chỉ dựa vào `sessionStorage`, người dùng có thể tự sửa session local và gọi API nếu API không xác thực lại.

Ví dụ rõ:

- `nhan_vien` có `email`, `so_dien_thoai`, `quy_phep_nam`, `ngay_sinh`; không nên grant SELECT trực tiếp cho anon.
- `kiem_tra_dot_xuat` có `token`, tọa độ thực tế, link ảnh mặt; nên server-only.
- `image_sync_jobs` có `supabase_public_url`, `supabase_path`, `drive_link`; nên server-only và cần xem lại bucket ảnh.
- `dm_khoa_phong_emails` có `mat_khau`; tuyệt đối không expose cho client.

## 4. Đánh Giá Phân Nhóm Của User

Phân nhóm ban đầu của bạn đúng hướng, nhưng với quyết định "dữ liệu chuyển hết qua API", nên siết thêm:

- Nhóm 1 Private: đủ mạnh, nên giữ và bổ sung thêm các bảng audit/phụ trợ.
- Nhóm 2 Public Read-Only: nếu browser không gọi Supabase trực tiếp nữa thì không cần `GRANT SELECT` cho `anon/authenticated` trên bảng gốc. Chuyển thành "Catalog server-read"; client lấy qua `/api/...`.
- Nhóm 3 dữ liệu cá nhân: không nên cho anon truy vấn bảng gốc, kể cả có RLS, vì RLS không giấu được cột. Nếu cần lookup nhân viên public, tạo API hoặc view rất hẹp, nhưng theo quyết định mới thì ưu tiên API.

Điều chỉnh chốt:

- Tất cả bảng gốc trong `public` chỉ grant cho `service_role`.
- Không grant `SELECT/INSERT/UPDATE/DELETE` cho `anon/authenticated` trên bảng gốc.
- Nếu sau này bắt buộc browser đọc trực tiếp, chỉ mở bằng view giới hạn cột, không mở bảng gốc.

## 5. Phân Nhóm Bảng Chốt

### Nhóm A - Auth, cấu hình, thiết bị, log, job: server-only tuyệt đối

Bảng:

- `dm_khoa_phong_emails`
- `cau_hinh_he_thong`
- `thiet_bi_nhan_vien`
- `log_gian_lan`
- `image_sync_jobs`
- `bang_truc_noi_bo`
- `lich_su_sua_nham_cham_cong`
- `lich_luan_chuyen`
- `lich_nghi_bu`

Quyền:

- Revoke all từ `anon`, `authenticated`.
- Grant đủ cho `service_role`.
- Enable RLS.
- Không tạo policy cho `anon/authenticated`.
- Chỉ thao tác qua API Next.js.

### Nhóm B - Danh mục và cấu hình đọc: server-read qua API

Bảng:

- `co_so`
- `dm_khoa_phong`
- `cau_hinh_ca_truc`
- `ngay_le`

Điều chỉnh so với phân nhóm ban đầu:

- Không grant SELECT trực tiếp cho `anon/authenticated` trên bảng gốc.
- Client lấy dữ liệu qua API như `/api/geofence`, `/api/admin/data`, `/api/manager/...`.
- Nếu API public cần đọc danh mục, API dùng `service_role` và chỉ trả field cần thiết.

Lý do:

- `dm_khoa_phong` hiện có `email_truong_khoa`.
- `co_so` có tọa độ/bán kính; không quá nhạy cảm nhưng không cần expose trực tiếp.
- Đi theo nguyên tắc "không để dữ liệu ở trình duyệt gọi Supabase trực tiếp".

### Nhóm C - Dữ liệu nhân viên và nghiệp vụ cá nhân: server-only + session

Bảng:

- `nhan_vien`
- `lich_su_cham_cong`
- `don_nghi_phep`
- `yeu_cau_quan_tri`
- `kiem_tra_dot_xuat`

Quyền:

- Revoke all từ `anon`, `authenticated`.
- Grant đủ cho `service_role`.
- Enable RLS.
- API bắt buộc xác thực session phù hợp trước khi trả dữ liệu.

Quy tắc:

- Employee chỉ xem dữ liệu của chính mình sau khi verify session.
- Manager chỉ xem/sửa dữ liệu thuộc `ma_khoa` trong session.
- Admin/TCCB được xem/sửa theo role.
- Không cho client ghi trực tiếp vào bảng này.

### Nhóm D - Storage ảnh chấm công/kiểm tra

Không nằm trong bảng Postgres nhưng rất nhạy cảm.

Khuyến nghị:

- Bucket ảnh nên private.
- Không trả `supabase_public_url` lâu dài cho client nếu ảnh có mặt người hoặc bằng chứng chấm công.
- API server trả signed URL ngắn hạn hoặc proxy ảnh khi người xem có quyền.
- `image_sync_jobs.supabase_public_url` nên được xem là dữ liệu nhạy cảm.

## 6. Auth Chốt Với `dm_khoa_phong_emails`

`dm_khoa_phong_emails` sẽ là bảng auth chính, không tách bảng mới.

Vai trò đề xuất:

- `ADMIN` hoặc `TCCB`: quản trị toàn hệ thống.
- `MANAGER`: quản trị theo `ma_khoa`.

Cột hiện có:

- `email`
- `ma_khoa`
- `ho_ten`
- `trang_thai`
- `mat_khau`

Cột nên bổ sung:

- `role text not null default 'MANAGER'`
- `password_changed_at timestamptz`
- `last_login_at timestamptz`
- `failed_login_count int not null default 0`
- `locked_until timestamptz`
- `session_version int not null default 1`

Ràng buộc nên có:

- `email` unique, lưu lowercase.
- Một email chỉ có một dòng/account trong `dm_khoa_phong_emails`, không tạo nhiều dòng trùng email theo role.
- `role` chỉ nhận `ADMIN`, `TCCB`, `MANAGER`.
- `ma_khoa` bắt buộc với `MANAGER`, có thể null với `ADMIN/TCCB`.
- Nếu một tài khoản `ADMIN/TCCB` cũng cần vào giao diện Manager cho một khoa, dùng chính dòng account đó và gán thêm `ma_khoa`; không tạo dòng `MANAGER` thứ hai cho cùng email.
- `mat_khau` chỉ lưu bcrypt hash, không lưu plain text.

Luồng đăng nhập:

1. Client gửi email/password đến API.
2. API dùng `service_role` đọc `dm_khoa_phong_emails`.
3. API kiểm tra trạng thái, lockout, bcrypt password.
4. API tạo session token server-side dạng httpOnly cookie.
5. Các API sau đọc cookie, verify token, lấy role/khoa từ token.
6. Client không tự giữ role/khoa làm nguồn sự thật; UI chỉ dùng để hiển thị.

## 7. Session Token Server-Side

Chốt dùng session token cho cả ba nhóm:

- `admin_session`
- `manager_session`
- `employee_session`

Yêu cầu cookie:

- `HttpOnly`
- `Secure` trên production
- `SameSite=Lax` hoặc `Strict`
- TTL ngắn:
  - Admin/TCCB: 4-8 giờ.
  - Manager: 8-12 giờ.
  - Employee dashboard: 30-120 phút.
- Có cơ chế logout xóa cookie.

Payload tối thiểu:

- Admin/TCCB: `sub`, `email`, `role`, `session_version`, `exp`.
- Manager: `sub`, `email`, `role`, `ma_khoa`, `is_test_account`, `session_version`, `exp`.
- Employee: `ma_nv`, `device_id_hash`, `session_version`, `exp`.

Không đưa vào token:

- Mật khẩu/hash.
- Email/số điện thoại nhân viên nếu không cần.
- Face descriptor nếu sau này bổ sung lại.
- Dữ liệu chấm công.

## 8. Employee Dashboard

Mục tiêu: chấm công không quá nặng, nhưng xem lịch sử phải chặt.

Luồng chốt:

- Chấm công nhanh:
  - Cho nhập `ma_nv`.
  - API kiểm tra nhân viên, geofence, device fingerprint, anti-fraud.
  - Nếu device đã active với `ma_nv`, cho chấm công.
  - Nếu device mới, bắt OTP email trước khi bind.
- Dashboard lịch sử:
  - Bắt buộc có `employee_session`.
  - Login bằng `ma_nv + device_id active`.
  - Nếu device chưa active hoặc nghi ngờ, bắt OTP.
  - API chỉ trả lịch sử của `ma_nv` trong session.

Không coi `ma_nv` là bí mật. `ma_nv` chỉ là định danh, không phải password.

## 9. Migration SQL Dự Kiến

Vì không có staging, không chạy một phát toàn bộ trên production. Cần tạo 3 script:

1. `audit.sql`: xem grants/policies hiện tại.
2. `apply.sql`: áp quyền mới theo từng block.
3. `rollback.sql`: khôi phục quyền tạm thời nếu app lỗi.

Khung `apply.sql`:

```sql
-- 1. Không tự expose object mới trong public
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

-- 2. Đóng toàn bộ bảng gốc với client roles
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

-- 3. Mở rõ cho service_role vì Data API cần grant explicit
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

-- 4. Sequences nếu có identity/serial
grant usage, select on all sequences in schema public to service_role;
revoke usage, select on all sequences in schema public from anon, authenticated;

-- 5. Bật RLS cho toàn bộ bảng gốc
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

-- 6. Function/RPC đang dùng bởi API
grant execute on function public.process_rotation_timeline(text, text, date, date, text) to service_role;
revoke execute on function public.process_rotation_timeline(text, text, date, date, text) from anon, authenticated;
```

Lưu ý:

- Chữ ký function `process_rotation_timeline` phải đối chiếu với schema thật trước khi chạy.
- Nếu function dùng kiểu tham số khác, SQL grant execute phải sửa đúng chữ ký.
- Không tạo policy cho `anon/authenticated` trong giai đoạn server-only.

## 10. Kế Hoạch Triển Khai Không Có Staging

Vì không có staging, thứ tự an toàn là:

1. Backup trước khi đổi:
   - Export schema.
   - Export grants/policies.
   - Backup dữ liệu quan trọng hoặc snapshot Supabase nếu gói hiện tại hỗ trợ.
2. Sửa code trước:
   - Dừng browser gọi Supabase table trực tiếp.
   - Tạo API thay thế cho các màn đang cần dữ liệu.
   - Thêm `requireAdmin`, `requireManager`, `requireEmployee`.
3. Deploy code mới.
4. Chạy audit SQL trên production và lưu output.
5. Chạy migration quyền theo block nhỏ:
   - Block default privileges.
   - Block grant service_role.
   - Block revoke anon/authenticated.
   - Block RLS.
   - Block function grants.
6. Test ngay sau mỗi block:
   - Chấm công.
   - Login employee dashboard.
   - Login manager.
   - Login admin.
   - Export Excel.
   - Cron daily/image sync nếu có thể gọi thủ công.
7. Nếu lỗi nghiêm trọng, chạy rollback tối thiểu để mở lại quyền cần thiết tạm thời.

## 11. Việc Cần Sửa Trong Code

### Đợt 1 - Bỏ browser Supabase table access

- `attendance/page.tsx`: thay `supabase.from('nhan_vien')` bằng API lookup.
- `admin/page.tsx`: thay query trực tiếp `yeu_cau_quan_tri` bằng API.
- Rà realtime channel ở `manager/page.tsx`; nếu chỉ để đồng bộ login thì có thể thay bằng session invalidation hoặc API heartbeat.

### Đợt 2 - Auth/session server-side

- Tạo helper:
  - `requireAdmin(req)`
  - `requireManager(req)`
  - `requireEmployee(req)`
- Tạo login API cho admin dùng `dm_khoa_phong_emails`.
- Manager API lấy `ma_khoa` từ token, không nhận từ query/body.
- Admin API lấy role từ token, không check password trong React client.
- Employee dashboard API verify `ma_nv + device_id active`.

### Đợt 3 - Migration Supabase

- Thêm migration SQL vào repo.
- Thêm `audit.sql` và `rollback.sql`.
- Regenerate `src/lib/database.types.ts` sau khi thêm cột auth.
- Chạy `npm run check:encoding`.

## 12. Checklist Kiểm Thử Bảo Mật

- Browser không còn `supabase.from(...)` tới bảng gốc.
- Anon key không SELECT được bất kỳ bảng gốc nào trong `public`.
- `service_role` API vẫn đọc/ghi được toàn bộ bảng cần thiết.
- Admin không login bằng password hard-code trong React client.
- Manager không xem/sửa được khoa khác bằng cách đổi query/body.
- Employee không xem lịch sử người khác bằng cách đổi `ma_nv`.
- Device chưa active không mở được employee dashboard nếu chưa OTP.
- `dm_khoa_phong_emails.mat_khau` không bao giờ trả về client.
- `nhan_vien.email`, `so_dien_thoai`, và dữ liệu sinh trắc nếu sau này bổ sung lại không trả ra ngoài nếu endpoint không cần.
- Ảnh chấm công/kiểm tra không public lâu dài nếu có mặt người.
- `process_rotation_timeline` chỉ execute bởi `service_role`.
- `npm run check:encoding` passed.

## 13. Thông Tin Cần Cung Cấp Thêm

Để triển khai SQL production an toàn, cần thêm:

1. Output grants/policies hiện tại từ Supabase SQL Editor.
2. Danh sách storage buckets hiện có, bucket nào public/private.
3. Chữ ký thật của function `process_rotation_timeline`.
4. Có bật Supabase backups/PITR/snapshot không.
5. Danh sách email nào là `ADMIN/TCCB`, email nào là `MANAGER`, và mapping `ma_khoa`.

## 14. Kết Luận Phân Nhóm

Phân nhóm ban đầu đủ đúng về hướng, nhưng chưa đủ mạnh nếu mục tiêu là "dữ liệu chuyển hết qua API". Bản chốt mới mạnh hơn:

- Không public-read bảng gốc.
- Không anon SELECT `nhan_vien`.
- Không anon SELECT danh mục gốc.
- Mọi dữ liệu qua API Next.js.
- `dm_khoa_phong_emails` là auth chính duy nhất.
- Session token server-side là nguồn quyền duy nhất.

Đây là phương án phù hợp nhất với dự án nội bộ, ít rườm rà, và đi đúng thay đổi mới của Supabase.

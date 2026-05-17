'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { v4 as uuidv4 } from 'uuid';
import {
  AlertTriangle,
  CheckSquare,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Pencil,
  RefreshCw,
  Send,
  Users,
  X,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { normalizeShiftType, SHIFT_TYPE_LABELS } from '@/lib/shift';
import { normalizeCampusCode } from '@/lib/campus';
import { useToast } from '@/components/ui/ToastProvider';

type ManagerSession = {
  email: string;
  khoa: string;
  ho_ten: string;
  sid: string;
  cho_phep_chia_ca_truc?: boolean;
  is_test_account?: boolean;
  allowed_shifts?: string[];
};

type RotationRequest = Database['public']['Tables']['yeu_cau_quan_tri']['Row'];
type ManagerEmployee = Pick<
  Database['public']['Tables']['nhan_vien']['Row'],
  'ma_nv' | 'ho_ten' | 'loai_truc_mac_dinh' | 'ma_co_so_mac_dinh' | 'trang_thai' | 'so_dien_thoai' | 'khoa_phong'
> & {
  // Trạng thái hiện tại (tính toán phía server, không lưu DB)
  trang_thai_hom_nay?: string | null;
};

type ManagerCorrectionRecord = Pick<
  Database['public']['Tables']['lich_su_cham_cong']['Row'],
  'id' | 'ma_nv' | 'ho_ten' | 'khoa_ghi_nhan' | 'loai_ca' | 'thoi_gian' | 'ghi_chu'
> & {
  group?: 'today' | 'yesterday';
  // Loại hỗ trợ cần thực hiện (do client tính toán)
  support_type?: 'FORGOT_CHECKOUT' | 'WRONG_SHIFT';
};

type StaffStatusRecord = Pick<
  Database['public']['Tables']['nhan_vien']['Row'],
  'ma_nv' | 'ho_ten' | 'loai_truc_mac_dinh' | 'ma_co_so_mac_dinh' | 'trang_thai' | 'so_dien_thoai' | 'khoa_phong'
> & {
  status: {
    has_actual: boolean;
    actual_data: Pick<
      Database['public']['Tables']['lich_su_cham_cong']['Row'],
      'id' | 'ma_nv' | 'loai_ca' | 'thoi_gian' | 'ho_tro_boi'
    > | null;
    has_plan: boolean;
    plan_data: Pick<
      Database['public']['Tables']['don_nghi_phep']['Row'],
      'id' | 'ma_nv' | 'loai_nghi' | 'tu_ngay' | 'den_ngay'
    > | null;
    display_state: 'ACTUAL' | 'PLAN' | 'NONE';
    display_type: string | null;
    is_resting?: boolean;
  };
};
type ManagerSpecialRecord = {
  id: string;
  ma_nv: string;
  ho_ten: string | null;
  in_time: string;
  out_time: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string;
};


const CA_OPTIONS = [
  { value: '', label: 'Mặc định theo nhân sự' },
  { value: 'HANH_CHINH', label: 'Hành chính' },
  { value: '3CA_4KIP', label: '3 ca 4 kíp' },
  { value: 'TRUC_12_24', label: 'Trực 12/24' },
  { value: 'TRUC_16_24', label: 'Trực 16/24' },
  { value: 'TRUC_24_24', label: 'Trực 24/24' },
];

const MANAGER_SESSION_KEY = 'mgr_session';

export default function ManagerDashboardAuth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<ManagerSession | null>(() => {
    if (typeof window === 'undefined') return null;
    const cached = sessionStorage.getItem(MANAGER_SESSION_KEY);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as ManagerSession;
    } catch {
      return null;
    }
  });

  const handleLogout = useCallback(() => {
    setSession(null);
    sessionStorage.removeItem(MANAGER_SESSION_KEY);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/manager/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        setLoginError(result.error || 'Không thể đăng nhập.');
        setLoading(false);
        return;
      }

      const { ma_khoa, ho_ten, cho_phep_chia_ca_truc, is_test_account, allowed_shifts } = result.data;
      const newSession: ManagerSession = {
        email,
        khoa: ma_khoa,
        ho_ten,
        cho_phep_chia_ca_truc,
        is_test_account,
        allowed_shifts,
        sid: uuidv4(),
      };
      sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(newSession));
      setSession(newSession);

      await supabase.channel('manager-auth').send({
        type: 'broadcast',
        event: 'LOGIN',
        payload: { email, newSid: newSession.sid },
      });
    } catch {
      setLoginError('Lỗi kết nối, vui lòng thử lại.');
    }

    setLoading(false);
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <div className="w-full max-w-md glass rounded-3xl shadow-2xl border border-white/60 overflow-hidden">
          <div className="bg-gradient-to-br from-primary/10 to-emerald-500/10 p-8 border-b border-glass-border">
            <div className="flex items-center gap-4">
              <div className="bg-primary/15 p-3 rounded-2xl">
                <Users size={32} className="text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-outfit">Quản Trị Khoa</h1>
                <p className="text-sm text-text-muted mt-0.5">Bệnh Viện Phụ Sản - Nhi Đà Nẵng</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">Email quản lý</label>
              <input
                required
                type="email"
                placeholder="Nhập email để đăng nhập"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3.5 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all bg-white/70"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">Mật khẩu</label>
              <div className="relative">
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Nhập mật khẩu đăng nhập"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3.5 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all bg-white/70 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {loginError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl">{loginError}</p>}
            <button disabled={loading} type="submit" className="w-full btn-primary py-3.5 font-bold text-base rounded-xl">
              {loading ? 'Đang xác thực...' : 'Vào Phiên Quản Trị'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <ManagerDashboard session={session} onLogout={handleLogout} />;
}

function ManagerDashboard({ session, onLogout }: { session: ManagerSession; onLogout: () => void }) {
  const [rotations, setRotations] = useState<RotationRequest[]>([]);
  const [employees, setEmployees] = useState<ManagerEmployee[]>([]);
  const [correctionRecords, setCorrectionRecords] = useState<ManagerCorrectionRecord[]>([]);
  const [specialRecords, setSpecialRecords] = useState<ManagerSpecialRecord[]>([]);
  const [staffStatusList, setStaffStatusList] = useState<StaffStatusRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { toastError, toastSuccess, toastWarning } = useToast();

  const isTest = session.is_test_account ?? false;

  const fetchAll = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const isTestParam = isTest ? '&is_test=true' : '&is_test=false';
      const [resRotation, resEmployees, resCorrection, resStaffStatus, resSpecial] = await Promise.all([
        fetch(`/api/manager/rotation/approve?khoa=${session.khoa}`),
        fetch(`/api/manager/employees?khoa=${session.khoa}${isTestParam}`),
        fetch(`/api/manager/attendance-corrections?khoa=${session.khoa}${isTestParam}`),
        fetch(`/api/manager/staff-status?khoa=${session.khoa}${isTestParam}`),
        fetch(`/api/manager/special-records?khoa=${session.khoa}${isTestParam}`),
      ]);
      if (resRotation.ok) setRotations((await resRotation.json()) as RotationRequest[]);
      if (resEmployees.ok) setEmployees((await resEmployees.json()) as ManagerEmployee[]);
      if (resCorrection.ok) setCorrectionRecords((await resCorrection.json()) as ManagerCorrectionRecord[]);
      if (resStaffStatus.ok) setStaffStatusList((await resStaffStatus.json()) as StaffStatusRecord[]);
      if (resSpecial.ok) setSpecialRecords((await resSpecial.json()) as ManagerSpecialRecord[]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [isTest, session.khoa]);

  useEffect(() => {
    void fetchAll(false);

    const authChannel = supabase.channel('manager-auth').on('broadcast', { event: 'LOGIN' }, (payload) => {
      if (payload.payload.email === session.email && payload.payload.newSid !== session.sid) {
        toastWarning('Phiên đăng nhập đã bị thay thế bởi thiết bị khác.');
        onLogout();
      }
    }).subscribe();

    const timer = setInterval(() => { void fetchAll(false); }, 20000);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(authChannel);
    };
  }, [fetchAll, onLogout, session.email, session.sid, toastWarning]);

  const approveRotation = async (requestId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn duyệt yêu cầu này?')) return;
    const res = await fetch('/api/manager/rotation/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, nguoi_duyet: session.email }),
    });

    if (!res.ok) {
      toastError('Thao tác thất bại.');
      return;
    }

    toastSuccess('Thao tác thành công.');
    void fetchAll(false);
  };

  const correctionGroups = useMemo(() => ({
    // Nhóm 1: Quên check-out hôm qua (ca kết thúc qua đêm)
    forgotCheckout: correctionRecords.filter((r) => r.group === 'yesterday'),
  }), [correctionRecords]);

  return (
    <div className="min-h-screen bg-bg-main p-6 lg:p-10 space-y-8">
      {session.email.startsWith('test_') && (
        <div className="bg-amber-500 text-white font-bold p-3 rounded-lg flex items-center justify-center gap-2 shadow-sm animate-pulse">
          <AlertTriangle size={20} /> CHẾ ĐỘ CHẠY THỬ (SANDBOX MODE) - Dữ liệu thực tế và báo cáo không bị ảnh hưởng.
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-3xl font-bold font-outfit uppercase">Quản Trị Khoa</h1>
          <p className="text-text-muted font-medium">Khoa: {session.khoa} • Đang trực tuyến: {session.ho_ten}</p>
        </div>

        <div className="flex items-center gap-3">
          {!isTest && (
            <button
              onClick={() => {
                const now = new Date();
                const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                window.open(`/api/export-excel?khoa=${session.khoa}&month=${month}`, '_blank');
              }}
              className="p-2 bg-white border border-glass-border rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
              title="Xuất Excel tháng này"
            >
              <FileSpreadsheet size={20} className="text-emerald-600" />
            </button>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            className="p-2 bg-white border border-glass-border rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
            title="Đổi mật khẩu"
          >
            <KeyRound size={20} className="text-slate-600" />
          </button>
          <button onClick={() => { void fetchAll(); }} className="p-2 bg-white border border-glass-border rounded-lg shadow-sm hover:bg-slate-50 transition-colors">
            <RefreshCw size={20} className={loading ? 'animate-spin text-primary' : 'text-slate-600'} />
          </button>
          <button onClick={onLogout} className="px-4 py-2 border text-red-600 border-red-200 bg-red-50 rounded-lg text-sm font-bold">Đăng xuất</button>
        </div>
      </header>

      <section className="glass rounded-xl p-6 shadow-sm border border-glass-border">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-700">
          <Send size={20} /> Lệnh Yêu Cầu Từ TCCB
        </h2>
        {rotations.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">Không có yêu cầu luân chuyển nào đang chờ.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rotations.map((rot) => {
              const isSource = rot.ma_khoa_nguon === session.khoa;
              return (
                <div key={rot.id} className="bg-slate-50 p-4 border border-indigo-200 rounded-xl">
                  <p className="text-sm font-medium text-slate-800">{isSource ? rot.noi_dung_nguon : rot.noi_dung_dich}</p>
                  <button onClick={() => void approveRotation(rot.id)} className="mt-4 w-full bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 transition font-bold text-sm py-2 rounded-lg">
                    Phê duyệt
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <TangCuongSection records={specialRecords} managerEmail={session.email} onRefresh={() => void fetchAll(false)} />

      <NhanSuSection
        employees={employees}
        khoa={session.khoa}
        managerEmail={session.email}
        allowedShifts={session.allowed_shifts ?? []}
        onRefresh={() => void fetchAll(false)}
      />

      <StaffSupportSection
        forgotCheckoutRecords={correctionGroups.forgotCheckout}
        staffStatusList={staffStatusList}
        khoa={session.khoa}
        managerEmail={session.email}
        isTest={isTest}
        onRefresh={() => void fetchAll(false)}
        toastError={toastError}
        toastSuccess={toastSuccess}
        toastWarning={toastWarning}
      />

      {showChangePassword && (
        <ChangePasswordModal email={session.email} onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}

type BangTrucRow = {
  ma_nv: string;
  ho_ten: string;
  loai_truc_mac_dinh: string | null;
  ma_co_so_mac_dinh: string | null;
  so_dien_thoai: string | null;
  loai_ca_phan_cong: string | null;
  nguoi_phan_cong: string | null;
  updated_at: string | null;
};

function TangCuongSection({ records, managerEmail, onRefresh }: { records: ManagerSpecialRecord[]; managerEmail: string; onRefresh: () => void }) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toastError, toastSuccess } = useToast();

  const handleAction = async (recordId: string, action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !rejectReason.trim()) {
      toastError('Vui lòng nhập lý do từ chối.');
      return;
    }
    setProcessingId(recordId);
    try {
      const res = await fetch('/api/manager/approve-special', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, recordId, reason: rejectReason, managerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error || 'Lỗi duyệt');
      } else {
        toastSuccess(data.message || 'Thành công');
        setRejectingId(null);
        setRejectReason('');
        onRefresh();
      }
    } catch {
      toastError('Lỗi kết nối');
    } finally {
      setProcessingId(null);
    }
  };

  if (!records || records.length === 0) return null;

  return (
    <section className="glass rounded-xl p-6 shadow-sm border border-glass-border">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-rose-600">
        <AlertTriangle size={20} /> Xác nhận Tăng Cường (Quỹ giờ đặc biệt)
      </h2>
      <div className="space-y-4">
        {records.map(rec => {
          const inTimeStr = new Date(rec.in_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          const outTimeStr = rec.out_time ? new Date(rec.out_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '... (Chưa kết thúc)';
          
          return (
            <div key={rec.id} className="bg-white p-4 rounded-xl border border-rose-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p className="font-semibold text-slate-800">{rec.ho_ten} ({rec.ma_nv})</p>
                <p className="text-sm text-slate-600">
                  {rec.out_time 
                    ? `Đã tăng cường từ ${inTimeStr} đến ${outTimeStr}`
                    : `Đang tăng cường từ ${inTimeStr}`}
                </p>
                {rec.status === 'REJECTED' && <p className="text-xs text-red-600 font-medium mt-1">Lý do từ chối: {rec.rejectReason}</p>}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                {rec.status === 'PENDING' && rejectingId !== rec.id && (
                  <>
                    <button 
                      onClick={() => handleAction(rec.id, 'APPROVE')} 
                      disabled={processingId === rec.id}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-sm disabled:opacity-50"
                    >
                      Xác nhận hợp lệ
                    </button>
                    <button 
                      onClick={() => setRejectingId(rec.id)} 
                      disabled={processingId === rec.id}
                      className="px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg font-bold text-sm disabled:opacity-50"
                    >
                      Từ chối
                    </button>
                  </>
                )}
                {rejectingId === rec.id && (
                  <div className="flex flex-col sm:flex-row items-center gap-2 w-full">
                    <input 
                      type="text" 
                      placeholder="Lý do từ chối..." 
                      className="border rounded-lg px-3 py-2 text-sm flex-1 outline-none focus:border-rose-400"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button 
                        onClick={() => handleAction(rec.id, 'REJECT')}
                        disabled={!rejectReason.trim() || processingId === rec.id}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex-1 sm:flex-none"
                      >
                        Lưu từ chối
                      </button>
                      <button 
                        onClick={() => { setRejectingId(null); setRejectReason(''); }}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold flex-1 sm:flex-none"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
                {rec.status === 'APPROVED' && (
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 size={14} /> Đã duyệt
                  </span>
                )}
                {rec.status === 'REJECTED' && (
                  <span className="px-3 py-1 bg-rose-100 text-rose-700 rounded-full text-xs font-bold flex items-center gap-1">
                    <XCircle size={14} /> Đã từ chối
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NhanSuSection({
  employees,
  khoa,
  managerEmail,
  allowedShifts,
  onRefresh,
}: {
  employees: ManagerEmployee[];
  khoa: string;
  managerEmail: string;
  allowedShifts: string[];
  onRefresh: () => void;
}) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [thang, setThang] = useState(defaultMonth);
  const [rows, setRows] = useState<BangTrucRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [editingEmp, setEditingEmp] = useState<ManagerEmployee | null>(null);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const res = await fetch(`/api/manager/bang-truc?khoa=${khoa}&thang=${thang}`);
      if (res.ok) setRows((await res.json()) as BangTrucRow[]);
    } finally {
      setLoadingRows(false);
    }
  }, [khoa, thang]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const handleAssign = async (ma_nv: string, ho_ten: string, loai_ca: string) => {
    setSaving(ma_nv);
    try {
      const normalizedAssignedShift = normalizeShiftType(loai_ca) ?? loai_ca;
      if (!loai_ca) {
        await fetch('/api/manager/bang-truc', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ khoa, thang, ma_nv }),
        });
      } else {
        await fetch('/api/manager/bang-truc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            khoa,
            thang,
            ma_nv,
            ho_ten,
            loai_ca: normalizedAssignedShift,
            nguoi_phan_cong: managerEmail,
          }),
        });
      }
      void fetchRows();
      onRefresh();
    } finally {
      setSaving(null);
    }
  };

  const rowMap = new Map(rows.map((r) => [r.ma_nv, r]));
  const filtered = [...employees]
    .filter((e) => !search || e.ho_ten?.toLowerCase().includes(search.toLowerCase()) || e.ma_nv?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.ho_ten || '').localeCompare(b.ho_ten || '', 'vi'));

  const cs1 = filtered.filter((e) => normalizeCampusCode(e.ma_co_so_mac_dinh) === 'CS1');
  const cs2 = filtered.filter((e) => normalizeCampusCode(e.ma_co_so_mac_dinh) === 'CS2');

  return (
    <section className="glass rounded-xl p-6 shadow-sm border border-glass-border">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 text-xl font-bold text-slate-700">
          <Users size={20} /> Nhân sự trong khoa ({employees.length} người)
          <span className="text-sm font-medium text-slate-500">{expanded ? '▲ Thu gọn' : '▼ Mở rộng'}</span>
        </button>
        <div className="flex flex-wrap gap-3 items-center">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tháng phân ca</label>
            <input type="month" value={thang} onChange={(e) => setThang(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-primary" />
          </div>
          <input type="text" placeholder="Tìm nhân viên..." value={search} onChange={(e) => setSearch(e.target.value)} className="p-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-primary w-48" />
          <button onClick={() => void fetchRows()} className="mt-4 p-2 border border-glass-border rounded-lg hover:bg-slate-50" title="Tải lại">
            <RefreshCw size={18} className={loadingRows ? 'animate-spin text-primary' : 'text-slate-500'} />
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {[{ key: 'CS1', list: cs1, color: 'bg-blue-50 text-blue-700' }, { key: 'CS2', list: cs2, color: 'bg-emerald-50 text-emerald-700' }].map((group) => (
            <div key={group.key} className="mb-4 rounded-xl border border-slate-200 bg-white/80">
              <div className={`px-4 py-2 text-sm font-bold ${group.color}`}>{group.key} - {group.list.length} nhân sự</div>
              {group.list.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Không có nhân sự.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-slate-400 border-b border-slate-100">
                        <th className="py-2 pl-4 text-left font-semibold">Họ tên</th>
                        <th className="py-2 text-left font-semibold">Mã NV</th>
                        <th className="py-2 text-left font-semibold">SĐT</th>
                        <th className="py-2 text-left font-semibold">Loại trực</th>
                        <th className="py-2 text-left font-semibold">Trạng thái</th>
                        <th className="py-2 text-left font-semibold">Phân công</th>
                        <th className="py-2 text-left font-semibold">Cập nhật</th>
                        <th className="py-2 text-left font-semibold">Sửa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {group.list.map((emp) => {
                        const row = rowMap.get(emp.ma_nv ?? '');
                        const norm = normalizeShiftType(emp.loai_truc_mac_dinh);
                        const status = emp.trang_thai_hom_nay;
                        return (
                          <tr key={emp.ma_nv} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2 pl-4 pr-4 font-semibold text-slate-800">{emp.ho_ten}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-slate-500">{emp.ma_nv}</td>
                            <td className="py-2 pr-4 text-xs text-slate-600">{emp.so_dien_thoai || '--'}</td>
                            <td className="py-2 pr-4"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">{SHIFT_TYPE_LABELS[norm ?? ''] ?? norm ?? 'N/A'}</span></td>
                            <td className="py-2 pr-4">
                              {status ? (
                                <span className="text-xs px-2 py-1 rounded-full font-semibold bg-orange-100 text-orange-700">{status}</span>
                              ) : (
                                <span className="text-xs text-slate-300">Bình thường</span>
                              )}
                            </td>
                            <td className="py-2 pr-4">
                              <select
                                value={normalizeShiftType(row?.loai_ca_phan_cong ?? '') ?? ''}
                                onChange={(e) => handleAssign(emp.ma_nv ?? '', emp.ho_ten ?? '', e.target.value)}
                                disabled={saving === emp.ma_nv}
                                className="p-1.5 border border-emerald-200 rounded-lg text-xs outline-none focus:border-emerald-500 bg-white disabled:opacity-60"
                              >
                                {CA_OPTIONS.filter(o => o.value === '' || allowedShifts.includes(o.value)).map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                              {saving === emp.ma_nv && <span className="text-xs text-emerald-600 ml-1">Đang lưu...</span>}
                            </td>
                            <td className="py-2 text-xs text-slate-400">
                              {row?.updated_at ? new Date(row.updated_at).toLocaleString('vi-VN') : '--'}
                              {row?.nguoi_phan_cong && <p className="text-[10px] text-slate-300">Bởi: {row.nguoi_phan_cong}</p>}
                            </td>
                            <td className="py-2 pr-2">
                              <button
                                onClick={() => setEditingEmp(emp)}
                                className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                                title="Sửa tên / SĐT"
                              >
                                <Pencil size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">Không có dữ liệu nhân sự phù hợp bộ lọc.</p>
          )}
        </>
      )}

      {/* Modal sửa thông tin */}
      {editingEmp && (
        <EditEmployeeModal
          emp={editingEmp}
          khoa={khoa}
          managerEmail={managerEmail}
          onClose={() => setEditingEmp(null)}
          onSaved={() => { setEditingEmp(null); onRefresh(); }}
        />
      )}
    </section>
  );
}

function EditEmployeeModal({
  emp,
  khoa,
  managerEmail,
  onClose,
  onSaved,
}: {
  emp: ManagerEmployee;
  khoa: string;
  managerEmail: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hoTen, setHoTen] = useState(emp.ho_ten ?? '');
  const [sdt, setSdt] = useState(emp.so_dien_thoai ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoTen.trim()) {
      setError('Tên không được để trống.');
      return;
    }

    setSaving(true);
    setError('');
    const res = await fetch('/api/manager/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ma_nv: emp.ma_nv,
        ho_ten: hoTen,
        so_dien_thoai: sdt,
        khoa,
        nguoi_sua: managerEmail,
      }),
    });
    const data = await res.json() as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? 'Lỗi cập nhật.');
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-outfit flex items-center gap-2">
            <Pencil size={18} /> Sửa thông tin
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>
        <p className="text-xs text-slate-500 mb-4 font-mono bg-slate-50 px-3 py-2 rounded-lg">{emp.ma_nv}</p>
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Họ và tên</label>
            <input
              required
              value={hoTen}
              onChange={(e) => setHoTen(e.target.value)}
              className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Số điện thoại</label>
            <input
              value={sdt}
              onChange={(e) => setSdt(e.target.value)}
              placeholder="(không bắt buộc)"
              className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}
          <button disabled={saving} type="submit" className="w-full btn-primary py-3 font-bold rounded-xl">
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Component: Bảng hỗ trợ check-in (dùng chung cho 2 nhóm)
// ─────────────────────────────────────────────────────
function CorrectionTable({
  records,
  onCorrect,
  showForceCheckout,
  onForceCheckout,
}: {
  records: ManagerCorrectionRecord[];
  onCorrect: (r: ManagerCorrectionRecord, t: 'IN_LAM' | 'IN_TRUC') => void;
  showForceCheckout: boolean;
  onForceCheckout: (r: ManagerCorrectionRecord) => void;
}) {
  if (records.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-400 border-b border-slate-100">
            <th className="py-2 text-left font-semibold">Nhân sự</th>
            <th className="py-2 text-left font-semibold">Check-in lúc</th>
            <th className="py-2 text-left font-semibold">Loại ca</th>
            <th className="py-2 text-left font-semibold">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {records.map((record) => {
            const isInLam = record.loai_ca === 'IN_LAM';
            return (
              <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-2 pr-4">
                  <p className="font-semibold text-slate-800">{record.ho_ten}</p>
                  <p className="font-mono text-xs text-slate-500">{record.ma_nv}</p>
                </td>
                <td className="py-2 pr-4 text-slate-600 text-xs">
                  {record.thoi_gian ? new Date(record.thoi_gian).toLocaleString('vi-VN') : '--'}
                </td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-1 rounded font-semibold ${isInLam ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'
                    }`}>
                    {isInLam ? 'HÀNH CHÍNH' : 'TRỰC'}
                  </span>
                </td>
                <td className="py-2 pr-2 flex flex-wrap gap-2">
                  {showForceCheckout && (
                    <button
                      onClick={() => onForceCheckout(record)}
                      className="text-xs bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 font-bold transition"
                    >
                      ⏱ Force Check-out
                    </button>
                  )}
                  <button
                    onClick={() => onCorrect(record, isInLam ? 'IN_TRUC' : 'IN_LAM')}
                    className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 font-bold transition"
                  >
                    Đổi → {isInLam ? 'TRỰC' : 'HÀNH CHÍNH'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChangePasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPw !== confirmPw) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    if (newPw.length < 8) {
      setError('Mật khẩu mới phải có ít nhất 8 ký tự.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/manager/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, old_password: oldPw, new_password: newPw }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error || 'Không thể đổi mật khẩu.');
        setSaving(false);
        return;
      }
      setSuccess('Đổi mật khẩu thành công.');
      setTimeout(onClose, 1200);
    } catch {
      setError('Lỗi kết nối, vui lòng thử lại.');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-bold font-outfit flex items-center gap-2"><KeyRound size={20} />Đổi mật khẩu</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mật khẩu hiện tại</label>
            <div className="relative">
              <input
                required
                type={showOldPw ? 'text' : 'password'}
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                className="w-full p-3 pr-11 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all"
              />
              <button
                type="button"
                onClick={() => setShowOldPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showOldPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mật khẩu mới</label>
            <div className="relative">
              <input
                required
                type={showNewPw ? 'text' : 'password'}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="w-full p-3 pr-11 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNewPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Xác nhận mật khẩu mới</label>
            <div className="relative">
              <input
                required
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="w-full p-3 pr-11 border border-slate-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{error}</p>}
          {success && <p className="text-xs text-emerald-600 bg-emerald-50 p-3 rounded-lg border border-emerald-100">{success}</p>}

          <button disabled={saving} type="submit" className="w-full btn-primary py-3 font-bold rounded-xl">
            {saving ? 'Đang xử lý...' : 'Lưu thay đổi'}
          </button>
        </form>
      </div>
    </div>
  );
}

function StaffSupportSection({
  forgotCheckoutRecords,
  staffStatusList,
  khoa,
  managerEmail,
  isTest,
  onRefresh,
  toastError,
  toastSuccess,
  toastWarning,
}: {
  forgotCheckoutRecords: ManagerCorrectionRecord[];
  staffStatusList: StaffStatusRecord[];
  khoa: string;
  managerEmail: string;
  isTest: boolean;
  onRefresh: () => void;
  toastError: (msg: string) => void;
  toastSuccess: (msg: string) => void;
  toastWarning: (msg: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<StaffStatusRecord | null>(null);

  const filteredStaff = useMemo(() => {
    if (!search) return staffStatusList;
    return staffStatusList.filter(s => s.ho_ten?.toLowerCase().includes(search.toLowerCase()) || s.ma_nv.toLowerCase().includes(search.toLowerCase()));
  }, [staffStatusList, search]);

  const handleQuickCheckin = async (emp: StaffStatusRecord, type: 'IN_LAM' | 'IN_TRUC') => {
    const reason = window.prompt(`Hỗ trợ check-in tay cho ${emp.ho_ten}?\nLý do khẩn cấp:`);
    if (!reason?.trim()) return;

    const res = await fetch('/api/manager/attendance-corrections/emergency-checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ma_nv: emp.ma_nv,
        ho_ten: emp.ho_ten,
        loai_ca: type,
        khoa,
        nguoi_ghi: managerEmail,
        ly_do: reason.trim(),
        is_test: isTest,
      }),
    });
    if (!res.ok) {
       const d = await res.json();
       toastError(d.error || 'Lỗi');
    } else {
       toastSuccess('Đã hỗ trợ check-in thành công.');
       onRefresh();
    }
  };

  const managerForceCheckout = async (record: ManagerCorrectionRecord) => {
    const reason = window.prompt(`Xác nhận check-out cho ${record.ho_ten ?? record.ma_nv}?\nNhập lý do:`);
    if (!reason || !reason.trim()) return;

    const res = await fetch('/api/manager/attendance-corrections/force-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        in_record_id: record.id,
        ma_nv: record.ma_nv,
        khoa,
        reason: reason.trim(),
        nguoi_sua: managerEmail,
        is_test: isTest,
      }),
    });
    if (!res.ok) {
       toastError((await res.json()).error || 'Lỗi');
    } else {
       toastSuccess('Đã ghi nhận check-out thành công');
       onRefresh();
    }
  };

  return (
    <section className="glass rounded-xl p-6 shadow-sm border border-amber-200">
      <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-amber-700">
        <CheckSquare size={20} /> Hỗ Trợ Check-in & Chế Độ
      </h2>
      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
        Chú ý: Lệnh Nghỉ sẽ bị vô hiệu hóa trong ngày nếu nhân viên có dữ liệu quét QR/GPS hợp lệ tại viện. Không được dùng nút check-in tay để cố tình đè lệnh nghỉ. Thao tác tay được lưu vết và giám sát.
      </p>

      {/* Tồn đọng check-out */}
      {forgotCheckoutRecords.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest mb-2 px-2 py-1 rounded inline-block bg-red-100 text-red-700">
              ⚠️ Quên Check-out Hôm Qua ({forgotCheckoutRecords.length})
            </h3>
            <CorrectionTable
              records={forgotCheckoutRecords}
              onCorrect={() => {}} // Disabled here to simplify
              showForceCheckout
              onForceCheckout={managerForceCheckout}
            />
          </div>
      )}

      {/* Bảng nhân sự khoa */}
      <h3 className="text-sm font-bold mt-4 mb-2">Trạng Thái Nhân Sự Hôm Nay</h3>
      <input type="text" placeholder="Tìm theo tên/mã NV..." value={search} onChange={e => setSearch(e.target.value)} className="w-full md:w-64 p-2 border border-slate-300 rounded-lg text-sm mb-4 outline-none" />
      
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold">
            <tr>
              <th className="p-3">Nhân sự</th>
              <th className="p-3">Trạng thái</th>
              <th className="p-3">Thao tác hỗ trợ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredStaff.map(emp => {
              const st = emp.status;
              const isDim = st.display_state !== 'NONE';
              return (
                <tr key={emp.ma_nv} className={`hover:bg-slate-50 transition-colors ${isDim ? 'opacity-60 bg-slate-50' : ''}`}>
                  <td className="p-3">
                    <p className="font-bold text-slate-800">{emp.ho_ten}</p>
                    <p className="font-mono text-xs text-slate-500">{emp.ma_nv}</p>
                  </td>
                  <td className="p-3">
                    {st.display_state === 'ACTUAL' && <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold border border-emerald-200">{st.display_type} (Thực tế)</span>}
                    {st.display_state === 'PLAN' && <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded text-xs font-bold border border-amber-200">{st.display_type} {st.is_resting ? '(Nghỉ bù sau trực)' : '(Kế hoạch)'}</span>}
                    {st.display_state === 'NONE' && <span className="text-slate-400 text-xs">Chưa có dữ liệu</span>}
                  </td>
                  <td className="p-3 flex gap-2 flex-wrap items-center">
                    {!isDim && (
                      <>
                        <button onClick={() => void handleQuickCheckin(emp, 'IN_LAM')} className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition">HC (+)</button>
                        <button onClick={() => void handleQuickCheckin(emp, 'IN_TRUC')} className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1.5 rounded-lg text-xs font-bold transition">Trực (TR)</button>
                        <button onClick={() => { setSelectedEmp(emp); setLeaveModalOpen(true); }} className="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">Nghỉ/Chế độ</button>
                      </>
                    )}
                    {isDim && st.display_state === 'PLAN' && (
                       <button className="border border-red-200 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-100 transition" onClick={() => {
                          if (!st.plan_data) return;
                          const conf = window.confirm('Sửa/Hủy lệnh nghỉ chỉ có hiệu lực từ NGÀY MAI.\nBấm OK để tiến hành cắt lệnh nghỉ này.');
                          if(conf) {
                             fetch('/api/leave', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: st.plan_data.id, manager_email: managerEmail})})
                             .then(() => { toastSuccess('Lệnh nghỉ sẽ bị vô hiệu từ ngày mai.'); onRefresh(); })
                             .catch(() => toastError('Lỗi hủy lệnh'));
                          }
                       }}>Hủy Lệnh Từ Ngày Mai</button>
                    )}
                    {isDim && st.display_state === 'ACTUAL' && (
                       <span className="text-xs text-emerald-600 font-medium">Đã Check-in</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {filteredStaff.length === 0 && (
               <tr><td colSpan={3} className="p-4 text-center text-sm text-slate-500">Không có nhân viên phù hợp</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {leaveModalOpen && selectedEmp && (
         <LeaveRangeModal 
           emp={selectedEmp} 
           managerEmail={managerEmail} 
           onClose={() => setLeaveModalOpen(false)} 
           onDone={() => {setLeaveModalOpen(false); onRefresh()}} 
           toastError={toastError}
           toastSuccess={toastSuccess}
           toastWarning={toastWarning}
         />
      )}
    </section>
  );
}

function LeaveRangeModal({
  emp,
  managerEmail,
  onClose,
  onDone,
  toastError,
  toastSuccess,
  toastWarning,
}: {
  emp: StaffStatusRecord;
  managerEmail: string;
  onClose: () => void;
  onDone: () => void;
  toastError: (msg: string) => void;
  toastSuccess: (msg: string) => void;
  toastWarning: (msg: string) => void;
}) {
  const [tuNgay, setTuNgay] = useState('');
  const [denNgay, setDenNgay] = useState('');
  const [loaiNghi, setLoaiNghi] = useState('NGHI_OM');
  const [buoiNghi, setBuoiNghi] = useState<'CA_NGAY' | 'SANG' | 'CHIEU'>('CA_NGAY');
  const [saving, setSaving] = useState(false);

  // Khi chon nghi buo sang/chieu, tu_ngay va den_ngay phai giong nhau
  const isHalfDay = loaiNghi === 'NGHI_PHEP' && buoiNghi !== 'CA_NGAY';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tuNgay > denNgay) return toastWarning('Tu ngay phai nho hon hoac bang Den ngay');
    if (isHalfDay && tuNgay !== denNgay) {
      return toastWarning('Nghi theo buoi (Sang/Chieu) chi ap dung cho don trong cung 1 ngay.');
    }
    setSaving(true);
    const res = await fetch('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ma_nv: emp.ma_nv,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        loai_nghi: loaiNghi,
        buoi_nghi: loaiNghi === 'NGHI_PHEP' ? buoiNghi : 'CA_NGAY',
        manager_email: managerEmail,
      })
    });
    setSaving(false);
    if (!res.ok) toastError(((await res.json()) as { error?: string }).error ?? 'Loi he thong');
    else { toastSuccess('Them lenh nghi thanh cong!'); onDone(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
         <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
            <div>
              <h3 className="font-bold text-xl text-slate-800">Dang ky lenh nghi</h3>
              <p className="text-sm font-medium text-slate-500">{emp.ho_ten} ({emp.ma_nv})</p>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Loai nghi / Che do</label>
              <select
                value={loaiNghi}
                onChange={(e) => { setLoaiNghi(e.target.value); setBuoiNghi('CA_NGAY'); }}
                className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:border-amber-500 font-medium text-slate-700 bg-slate-50"
              >
                 <option value="NGHI_OM">Om (O)</option>
                 <option value="NGHI_PHEP">Nghi phep (P)</option>
                 <option value="THAI_SAN">Thai san (Ts)</option>
                 <option value="CONG_TAC">Cong tac (Ct)</option>
                 <option value="CON_OM">Con om (Co)</option>
              </select>
            </div>

            {/* Dropdown buoi nghi - chi hien khi chon Nghi phep */}
            {loaiNghi === 'NGHI_PHEP' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Buoi ap dung</label>
                <select
                  value={buoiNghi}
                  onChange={(e) => setBuoiNghi(e.target.value as 'CA_NGAY' | 'SANG' | 'CHIEU')}
                  className="w-full p-2.5 border border-amber-300 rounded-lg outline-none focus:border-amber-500 font-medium text-slate-700 bg-amber-50"
                >
                  <option value="CA_NGAY">Ca ngay (toan bo)</option>
                  <option value="SANG">Nghi buoi sang (+/P: sang nghi, chieu di lam)</option>
                  <option value="CHIEU">Nghi buoi chieu (P/+: sang di lam, chieu nghi)</option>
                </select>
                {isHalfDay && (
                  <p className="text-xs text-amber-600 mt-1">
                    * Nghi theo buoi: chi duoc chon 1 ngay (Tu ngay = Den ngay). Tru 0.5 ngay phep.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-4">
              <div className="w-1/2">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Tu ngay</label>
                <input required type="date" value={tuNgay} onChange={(e) => setTuNgay(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-amber-500 bg-slate-50" />
              </div>
              <div className="w-1/2">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Den ngay</label>
                <input
                  required
                  type="date"
                  value={denNgay}
                  onChange={(e) => setDenNgay(e.target.value)}
                  min={isHalfDay ? tuNgay : undefined}
                  max={isHalfDay ? tuNgay : undefined}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-amber-500 bg-slate-50"
                />
              </div>
            </div>
            
            <div className="flex gap-3 pt-3">
              <button type="button" onClick={onClose} className="w-1/2 bg-white border border-slate-300 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-bold text-slate-600 transition">Huy bo</button>
              <button type="submit" disabled={saving} className="w-1/2 bg-slate-800 hover:bg-slate-900 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition shadow-sm">{saving ? 'Dang luu...' : 'Xac nhan'}</button>
            </div>
         </form>
      </div>
    </div>
  )
}

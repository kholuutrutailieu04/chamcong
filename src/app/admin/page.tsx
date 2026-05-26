'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import type { Database } from '@/lib/database.types';
import type { ReactNode } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { 
  Users, 
  Settings, 
  ShieldAlert, 
  FileSpreadsheet, 
  Upload, 
  RefreshCw,
  CheckCircle2,
  ArrowRightLeft,
  Eye,
  EyeOff,
  X
} from 'lucide-react';

type Employee = Database['public']['Tables']['nhan_vien']['Row'];
type SystemConfig = Database['public']['Tables']['cau_hinh_he_thong']['Row'];
type FraudSummaryItem = { ma_nv: string; ho_ten: string; khoa: string; loi_vi_pham: string };
type FraudSubTab = 'SO_DEN' | 'MANAGER';
type KhoaOption = Pick<Database['public']['Tables']['dm_khoa_phong']['Row'], 'ma_khoa' | 'ten_khoa'>;
type CoSoOption = Pick<Database['public']['Tables']['co_so']['Row'], 'ma_co_so' | 'ten_co_so'>;
type RotationHistory = Database['public']['Tables']['yeu_cau_quan_tri']['Row'];
type RandomCheckResult = Database['public']['Tables']['kiem_tra_dot_xuat']['Row'];
type ManagerManualRecent = Pick<
  Database['public']['Tables']['lich_su_cham_cong']['Row'],
  'id' | 'ma_nv' | 'ho_ten' | 'thoi_gian' | 'loai_ca' | 'ho_tro_boi'
> & {
  khoa: string | null;
};
type ManagerManualSummary = {
  key: string;
  manager: string;
  khoa: string;
  count: number;
};
type ManagerFraudResponse = {
  recent: ManagerManualRecent[];
  summary: ManagerManualSummary[];
};

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

interface RotationPreview {
  ho_ten: string;
  ma_nv: string;
  khoa_nguon: string;
  co_so_nguon: string;
  khoa_dich: string;
  co_so_dich: string;
  tu_ngay: string;
  den_ngay: string;
  loai_truc_cu: string;
  loai_truc_moi: string;
  canh_bao_loai_truc: boolean;
}

// -------------------------------------------------------------------
// ADMIN AUTH GUARD (bảo vệ bằng Cookie JWT)
// -------------------------------------------------------------------

export default function AdminDashboardAuth() {
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Restore session từ cookie khi load trang
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => r.json())
      .then(data => {
        if (data.session?.email) {
          setAuthed(data.session.email as string);
        }
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail.trim(), password }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        setAuthError(result.error || 'Không thể đăng nhập.');
      } else {
        setAuthed(adminEmail.trim().toLowerCase());
      }
    } catch {
      setAuthError('Lỗi kết nối. Vui lòng thử lại.');
    }
    setChecking(false);
  };

  if (sessionLoading) return null;

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={handleAdminLogin} className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6">
          <div className="text-center">
            <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={32} className="text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-outfit">Cổng TCCB</h2>
            <p className="text-sm text-slate-500 mt-1">Vui lòng xác thực email quản trị để tiếp tục.</p>
          </div>
          <div>
            <input
              required type="email"
              placeholder="email@benhvien.vn"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:border-primary text-sm"
            />
          </div>
          <div className="relative">
            <input
              required type={showPassword ? 'text' : 'password'}
              placeholder="Nhập mật khẩu quản trị"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full p-3 pr-10 border border-slate-300 rounded-xl outline-none focus:border-primary text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {authError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg">{authError}</p>}
          <button disabled={checking} type="submit" className="w-full btn-primary py-3 font-bold">
            {checking ? 'Đang kiểm tra...' : 'Vào Cổng Quản Trị'}
          </button>
        </form>
      </main>
    );
  }

  return <AdminDashboard adminEmail={authed} onLogout={async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(null);
  }} />;
}

function AdminDashboard({ adminEmail, onLogout }: { adminEmail: string; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'employees' | 'rotation' | 'randomCheck' | 'config' | 'export' | 'fraud'>('employees');
  const [snapCheckQueue, setSnapCheckQueue] = useState<string[]>([]);
  const [targetRotationEmp, setTargetRotationEmp] = useState<string | null>(null);
  
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col p-6 space-y-8 h-screen sticky top-0 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-lg">
            <Users size={24} />
          </div>
          <div>
            <span className="text-xl font-bold font-outfit uppercase tracking-tighter block leading-none">TCCB</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-widest">Portal V2</span>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem active={activeTab === 'employees'} onClick={() => setActiveTab('employees')} icon={<Users size={20} />} label="Quản Trị Nhân Sự" />
          <SidebarItem active={activeTab === 'rotation'} onClick={() => setActiveTab('rotation')} icon={<ArrowRightLeft size={20} />} label="Luân Chuyển NV" />
          <SidebarItem active={activeTab === 'randomCheck'} onClick={() => setActiveTab('randomCheck')} icon={<ShieldAlert size={20} />} label="Kiểm Tra Đột Xuất" />
          <SidebarItem active={activeTab === 'config'} onClick={() => setActiveTab('config')} icon={<Settings size={20} />} label="Cấu Hình Hệ Thống" />
          <SidebarItem active={activeTab === 'export'} onClick={() => setActiveTab('export')} icon={<FileSpreadsheet size={20} />} label="Trung Tâm Báo Cáo" />
          <SidebarItem active={activeTab === 'fraud'} onClick={() => setActiveTab('fraud')} icon={<ShieldAlert size={20} />} label="Giám Sát Sổ Đen" />
        </nav>

        <button onClick={onLogout} className="text-xs text-slate-500 hover:text-red-400 transition text-left">
          ← Đăng xuất ({adminEmail.split('@')[0]})
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 h-screen overflow-y-auto">
        {activeTab === 'employees' && (
          <EmployeeTab 
            adminEmail={adminEmail}
            onNavigateToRotation={(ma_nv) => { setTargetRotationEmp(ma_nv); setActiveTab('rotation'); }}
            snapCheckQueue={snapCheckQueue}
            onToggleSnapCheck={(ma_nv) => {
              setSnapCheckQueue(prev => prev.includes(ma_nv) ? prev.filter(id => id !== ma_nv) : [...prev, ma_nv]);
            }}
          />
        )}
        {activeTab === 'rotation'  && <RotationTab initialTargetEmp={targetRotationEmp} />}
        {activeTab === 'randomCheck' && <RandomCheckTab queue={snapCheckQueue} />}
        {activeTab === 'config'    && <ConfigTab adminEmail={adminEmail} />}
        {activeTab === 'export'    && <ExportTab />}
        {activeTab === 'fraud'     && <FraudTab />}
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: SidebarItemProps) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
        active ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

// ----------------------------------------------------
// TAB 1: QUẢN TRỊ NHÂN SỰ & IMPORT CSV
// ----------------------------------------------------
interface EmployeeTabProps {
  adminEmail: string;
  onNavigateToRotation: (ma_nv: string) => void;
  snapCheckQueue: string[];
  onToggleSnapCheck: (ma_nv: string) => void;
}

function EmployeeTab({ adminEmail, onNavigateToRotation, snapCheckQueue, onToggleSnapCheck }: EmployeeTabProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [khoas, setKhoas] = useState<KhoaOption[]>([]);
  
  // States for filtering & searching
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKhoa, setFilterKhoa] = useState('ALL');
  const [filterPhep, setFilterPhep] = useState('ALL');
  const khoaNameByCode = useMemo(() => {
    return new Map(khoas.map((k) => [k.ma_khoa, k.ten_khoa || k.ma_khoa]));
  }, [khoas]);

  // Modal State
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  useEffect(() => {
    if (!editingEmp) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditingEmp(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editingEmp]);

  const fetchEmployees = async () => {
    setLoading(true);
    const isTest = adminEmail.toLowerCase().startsWith('test_');
    const res = await fetch(`/api/admin/data?type=employees&is_test=${isTest ? 'true' : 'false'}`);
    const data = await res.json();
    setEmployees(Array.isArray(data) ? (data as Employee[]) : []);
    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;
    const isTest = adminEmail.toLowerCase().startsWith('test_');
    fetch(`/api/admin/data?type=employees&is_test=${isTest ? 'true' : 'false'}`)
      .then(r => r.json())
      .then(data => {
        if (!isMounted) return;
        setEmployees(Array.isArray(data) ? (data as Employee[]) : []);
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setEmployees([]);
        setLoading(false);
      });
    
    // Fetch khoas qua API backend (bypass RLS)
    fetch('/api/admin/data?type=khoas')
      .then(r => r.json())
      .then(data => { if (isMounted && Array.isArray(data)) setKhoas(data as KhoaOption[]); })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [adminEmail]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result;
      try {
        const res = await fetch('/api/admin/employees/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`Thành công! ${data.message} (Chỉ thêm người mới, giữ nguyên NV cũ)`);
          fetchEmployees();
        } else {
          alert(`Lỗi: ${data.error}`);
        }
      } catch { alert('Lỗi kết nối server.'); }
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const calculateTotalLeave = (ngay_vao: string | null, base: number) => {
    if (!ngay_vao) return base;
    const years = new Date().getFullYear() - new Date(ngay_vao).getFullYear();
    return base + Math.floor(years / 5);
  };

  const handleSaveEmp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    
    // Nếu xóa trắng thì chuyển thành null để không vi phạm ràng buộc Unique/Check của Database
    const cleanPhone = editingEmp.so_dien_thoai?.trim() || null;
    const cleanEmail = editingEmp.email?.trim() || null;

    try {
      const res = await fetch('/api/admin/data?type=employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingEmp.id,
          email: cleanEmail,
          so_dien_thoai: cleanPhone
        })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
      
      setEditingEmp(null);
      fetchEmployees();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật';
      alert(`Lỗi cập nhật: ${msg}`);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    const khoaName = khoaNameByCode.get(emp.khoa_phong) ?? emp.khoa_phong;
    const normalizedSearch = searchQuery.toLowerCase();
    const matchSearch = emp.ma_nv?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        emp.ho_ten?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        khoaName.toLowerCase().includes(normalizedSearch) ||
                        emp.khoa_phong.toLowerCase().includes(normalizedSearch);
    const matchKhoa = filterKhoa === 'ALL' || emp.khoa_phong === filterKhoa;
    
    let matchPhep = true;
    if (filterPhep === 'LOW') matchPhep = (emp.quy_phep_nam || 0) <= 3;
    if (filterPhep === 'HIGH') matchPhep = (emp.quy_phep_nam || 0) > 10;

    return matchSearch && matchKhoa && matchPhep;
  });

  return (
    <div className="space-y-6 animate-fade-in relative">
      <header className="flex justify-between items-end border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold font-outfit text-slate-800">Cơ Sở Dữ Liệu Nhân Sự</h2>
          <p className="text-sm text-slate-500 mt-1">Danh sách bác sĩ, y tá và cán bộ nhân viên toàn viện</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchEmployees} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100">
             <RefreshCw size={20} className={`text-slate-600 ${loading ? 'animate-spin':''}`} />
          </button>
          <div>
            <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-primary flex items-center gap-2 px-6"
            >
              <Upload size={18} /> {uploading ? 'Đang nạp...' : 'Tải lên danh sách (CSV)'}
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <input 
          type="text" 
          placeholder="Tìm theo Mã NV hoặc Tên..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary w-64 text-sm"
        />
        <select 
          value={filterKhoa} 
          onChange={e => setFilterKhoa(e.target.value)}
          className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary text-sm max-w-xs"
        >
          <option value="ALL">-- Tất cả Khoa --</option>
          {khoas.map(k => <option key={k.ma_khoa} value={k.ma_khoa}>{k.ten_khoa}</option>)}
        </select>
        <select 
          value={filterPhep} 
          onChange={e => setFilterPhep(e.target.value)}
          className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary text-sm"
        >
          <option value="ALL">-- Lọc số phép --</option>
          <option value="LOW">Sắp hết (≤ 3 ngày)</option>
          <option value="HIGH">Còn nhiều (&gt; 10 ngày)</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
           <p className="text-center p-10 text-slate-500">Đang tải...</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 min-w-[1000px]">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-xs">
              <tr>
                <th className="px-4 py-4 font-semibold">Nhân viên</th>
                <th className="px-4 py-4 font-semibold">SĐT / Email</th>
                <th className="px-4 py-4 font-semibold">Khoa Phòng</th>
                <th className="px-4 py-4 font-semibold">Hạn Mức Phép Năm</th>
                <th className="px-4 py-4 font-semibold text-right">Tác vụ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.map(emp => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800">{emp.ho_ten}</div>
                    <div className="font-mono text-xs text-slate-500">{emp.ma_nv}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{emp.so_dien_thoai || '---'}</div>
                    <div className="text-xs text-slate-500">{emp.email || '---'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{khoaNameByCode.get(emp.khoa_phong) ?? emp.khoa_phong}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-emerald-50 text-emerald-700 font-bold rounded text-xs border border-emerald-100">
                      Tổng: {calculateTotalLeave(emp.ngay_vao_lam, 12)} | Còn: {emp.quy_phep_nam}
                    </span>
                  </td>
                  <td className="px-4 py-3 flex gap-2 justify-end">
                    <button 
                      onClick={() => setEditingEmp(emp)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 text-xs font-semibold transition"
                    >
                      Sửa
                    </button>
                    <button 
                      onClick={() => onNavigateToRotation(emp.ma_nv || '')}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-xs font-semibold transition"
                    >
                      Luân Chuyển
                    </button>
                    <button 
                      onClick={() => onToggleSnapCheck(emp.ma_nv || '')}
                      className={`px-3 py-1.5 rounded text-xs font-semibold transition border ${
                        snapCheckQueue.includes(emp.ma_nv || '') 
                          ? 'bg-rose-50 text-rose-600 border-rose-200' 
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {snapCheckQueue.includes(emp.ma_nv || '') ? 'Đã Chọn Đột Xuất' : '+ Đột Xuất'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEmployees.length === 0 && (
                <tr><td colSpan={5} className="text-center p-8 text-slate-500">Không tìm thấy kết quả</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <EmployeeEditModal
        editingEmp={editingEmp}
        onClose={() => setEditingEmp(null)}
        onSubmit={handleSaveEmp}
        onChange={setEditingEmp}
      />
    </div>
  );
}

function EmployeeEditModal({
  editingEmp,
  onClose,
  onSubmit,
  onChange,
}: {
  editingEmp: Employee | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
  onChange: (emp: Employee | null) => void;
}) {
  if (!editingEmp || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="button"
      tabIndex={-1}
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cập nhật thông tin nhân sự"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold font-outfit">Cập nhật thông tin</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Đóng"
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Mã NV (Khóa)</label>
            <input type="text" value={editingEmp.ma_nv || ''} disabled className="w-full p-2 border rounded-lg bg-slate-100 text-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Họ Tên (Khóa)</label>
            <input type="text" value={editingEmp.ho_ten || ''} disabled className="w-full p-2 border rounded-lg bg-slate-100 text-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Số điện thoại</label>
            <input type="text" value={editingEmp.so_dien_thoai || ''} onChange={e => onChange({ ...editingEmp, so_dien_thoai: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Email</label>
            <input type="email" value={editingEmp.email || ''} onChange={e => onChange({ ...editingEmp, email: e.target.value })} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-primary" />
          </div>
          <div className="flex gap-3 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-slate-50">Hủy</button>
            <button type="submit" className="btn-primary px-6 py-2">Lưu Thay Đổi</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ----------------------------------------------------
// TAB 2: CẤU HÌNH HỆ THỐNG
// ----------------------------------------------------
type AutoCloseOpenInConfig = {
  enabled: boolean;
  pendingValue: boolean | null;
  effectiveDate: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type AutoEmailReportConfig = {
  enabled: boolean;
  scheduleLabel: string;
};

const AUTO_CLOSE_CONFIG_KEYS = new Set([
  'AUTO_CLOSE_OPEN_IN_ENABLED',
  'AUTO_CLOSE_OPEN_IN_PENDING_VALUE',
  'AUTO_CLOSE_OPEN_IN_EFFECTIVE_DATE',
  'AUTO_CLOSE_OPEN_IN_UPDATED_BY',
  'AUTO_CLOSE_OPEN_IN_UPDATED_AT',
  'AUTO_EMAIL_REPORT_ENABLED',
]);

const SYSTEM_READONLY_CONFIG_KEYS = new Set([
  'MASTER_OTP',
  'AUTO_CLOSE_OPEN_IN_PENDING_VALUE',
  'AUTO_CLOSE_OPEN_IN_EFFECTIVE_DATE',
  'AUTO_CLOSE_OPEN_IN_UPDATED_BY',
  'AUTO_CLOSE_OPEN_IN_UPDATED_AT',
]);

function isBooleanConfig(config: SystemConfig): boolean {
  return config.kieu_du_lieu === 'boolean' || config.value === 'true' || config.value === 'false';
}

function getClientVNDatePlus(days: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return date.toISOString().split('T')[0];
}

function ConfigTab({ adminEmail }: { adminEmail: string }) {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingOtp, setGeneratingOtp] = useState(false);
  const [masterOtp, setMasterOtp] = useState<string | null>(null);
  const [autoCloseConfig, setAutoCloseConfig] = useState<AutoCloseOpenInConfig | null>(null);
  const [autoCloseTarget, setAutoCloseTarget] = useState<boolean | null>(null);
  const [savingAutoClose, setSavingAutoClose] = useState(false);
  const [autoEmailReportConfig, setAutoEmailReportConfig] = useState<AutoEmailReportConfig | null>(null);
  const [savingAutoEmailReport, setSavingAutoEmailReport] = useState(false);

  const generateMasterOtp = async () => {
    if (!confirm('Bạn có chắc muốn sinh ra một mã OTP khẩn cấp dùng chung cho tất cả nhân viên? (Có hiệu lực 10 phút)')) return;
    setGeneratingOtp(true);
    try {
      const res = await fetch('/api/admin/generate-master-otp', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMasterOtp(data.otp);
        fetchConfigs(); // Refresh configs list to show the new OTP in the list as well (optional)
      } else {
        alert('Lỗi: ' + data.error);
      }
    } catch {
      alert('Lỗi kết nối.');
    }
    setGeneratingOtp(false);
  };

  const fetchConfigs = async () => {
    setLoading(true);
    const [configRes, autoCloseRes, autoEmailReportRes] = await Promise.all([
      fetch('/api/admin/data?type=configs'),
      fetch('/api/admin/auto-close-open-in'),
      fetch('/api/admin/report-email'),
    ]);
    const data = await configRes.json();
    const autoCloseData = await autoCloseRes.json();
    const autoEmailReportData = await autoEmailReportRes.json();
    setConfigs(Array.isArray(data) ? data as SystemConfig[] : []);
    if (autoCloseRes.ok) setAutoCloseConfig(autoCloseData as AutoCloseOpenInConfig);
    if (autoEmailReportRes.ok) setAutoEmailReportConfig(autoEmailReportData as AutoEmailReportConfig);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchConfigs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleUpdate = async (key: string, newValue: string) => {
    const res = await fetch('/api/admin/data?type=configs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: newValue }),
    });
    if (!res.ok) alert('Lỗi khi cập nhật!');
    else fetchConfigs();
  };

  const requestAutoCloseChange = async () => {
    if (autoCloseTarget === null) return;
    setSavingAutoClose(true);
    try {
      const res = await fetch('/api/admin/auto-close-open-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: autoCloseTarget, admin_email: adminEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Lỗi khi cập nhật công tắc.');
      } else {
        setAutoCloseConfig(data as AutoCloseOpenInConfig);
        await fetchConfigs();
      }
    } catch {
      alert('Lỗi kết nối.');
    } finally {
      setSavingAutoClose(false);
      setAutoCloseTarget(null);
    }
  };

  const toggleAutoEmailReport = async () => {
    const nextValue = !(autoEmailReportConfig?.enabled ?? false);
    setSavingAutoEmailReport(true);
    try {
      const res = await fetch('/api/admin/report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Lỗi khi cập nhật gửi báo cáo tự động.');
      } else {
        setAutoEmailReportConfig(data as AutoEmailReportConfig);
        await fetchConfigs();
      }
    } catch {
      alert('Lỗi kết nối.');
    } finally {
      setSavingAutoEmailReport(false);
    }
  };

  const effectiveDisplay = autoCloseConfig?.effectiveDate || getClientVNDatePlus(7);
  const activeAutoCloseValue = autoCloseConfig?.pendingValue ?? autoCloseConfig?.enabled ?? true;
  const displayConfigs = configs.filter((cf) => !['AUTO_CLOSE_OPEN_IN_ENABLED', 'AUTO_EMAIL_REPORT_ENABLED', 'THANG_DA_XAC_NHAN'].includes(cf.key));

  return (
    <>
      <div className="space-y-6 animate-fade-in max-w-4xl">
        <header className="border-b border-slate-200 pb-4 flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold font-outfit text-slate-800">Biến Hệ Thống & Cấu Hình</h2>
            <p className="text-sm text-slate-500 mt-1">Thay đổi các thông số kỹ thuật hoạt động của Bot tự động</p>
          </div>
          
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl max-w-sm text-center shadow-sm">
            <h3 className="font-bold text-rose-700 flex items-center justify-center gap-2 mb-2">
              <ShieldAlert size={18} /> Cấp Mã OTP Khẩn Cấp
            </h3>
            <p className="text-xs text-rose-600 mb-3 leading-relaxed">
              Dùng khi nhân viên bị lỗi không nhận được email. Mã dùng chung toàn viện và có thời hạn 10 phút.
            </p>
            <button 
              onClick={generateMasterOtp}
              disabled={generatingOtp}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded-lg text-sm transition"
            >
              {generatingOtp ? 'Đang tạo...' : 'Tạo Mã Ngay'}
            </button>
            {masterOtp && (
              <div className="mt-4 pt-4 border-t border-rose-200 animate-fade-in">
                <p className="text-xs font-semibold text-rose-600 uppercase tracking-wider mb-1">Mã của bạn</p>
                <p className="text-4xl font-mono font-black text-rose-800 tracking-[0.2em]">{masterOtp}</p>
              </div>
            )}
          </div>
        </header>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${activeAutoCloseValue ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <h3 className="font-bold text-slate-800">Tự sinh OUT khi check-in ca mới</h3>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl">
              Trạng thái hiện tại: <b>{autoCloseConfig?.enabled === false ? 'Tắt' : 'Bật'}</b>
              {autoCloseConfig?.pendingValue !== null && autoCloseConfig?.pendingValue !== undefined && (
                <span className="ml-2 text-amber-700">
                  Chờ áp dụng: <b>{autoCloseConfig.pendingValue ? 'Bật' : 'Tắt'}</b> từ <b>{autoCloseConfig.effectiveDate}</b>
                </span>
              )}
            </p>
            {autoCloseConfig?.updatedBy && (
              <p className="text-xs text-slate-400">Cập nhật gần nhất bởi {autoCloseConfig.updatedBy}</p>
            )}
          </div>
          <button
            onClick={() => setAutoCloseTarget(!activeAutoCloseValue)}
            disabled={loading || savingAutoClose}
            className={`px-5 py-3 rounded-xl text-sm font-bold text-white shadow-sm transition ${
              activeAutoCloseValue ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {activeAutoCloseValue ? 'Lên lịch tắt' : 'Lên lịch bật'}
          </button>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${autoEmailReportConfig?.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <h3 className="font-bold text-slate-800">Tự động gửi Excel khoa qua email</h3>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl">
              Trạng thái hiện tại: <b>{autoEmailReportConfig?.enabled ? 'Bật' : 'Tắt'}</b>. Email nhận lấy từ <b>dm_khoa_phong.email_truong_khoa</b>.
            </p>
            {autoEmailReportConfig?.scheduleLabel && (
              <p className="text-xs text-slate-400">Lịch gửi khai báo trên server: {autoEmailReportConfig.scheduleLabel}</p>
            )}
          </div>
          <button
            onClick={() => void toggleAutoEmailReport()}
            disabled={loading || savingAutoEmailReport}
            className={`px-5 py-3 rounded-xl text-sm font-bold text-white shadow-sm transition ${
              autoEmailReportConfig?.enabled ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {savingAutoEmailReport ? 'Đang lưu...' : autoEmailReportConfig?.enabled ? 'Tắt gửi tự động' : 'Bật gửi tự động'}
          </button>
        </section>

        {loading ? <p>Loading...</p> : (
          <div className="space-y-4">
            {displayConfigs.map(cf => {
              const isReadonly = SYSTEM_READONLY_CONFIG_KEYS.has(cf.key);
              const isAutoGenerated = AUTO_CLOSE_CONFIG_KEYS.has(cf.key);
              const isBoolean = isBooleanConfig(cf);

              return (
              <div key={cf.key} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div className="max-w-xl">
                  <h4 className="font-bold text-slate-800 tracking-wider text-sm">{cf.mo_ta || cf.key}</h4>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{cf.key}</p>
                  {isReadonly && (
                    <p className="text-[11px] text-slate-400 mt-2">
                      {isAutoGenerated ? 'Hệ thống tự điền khi bật/tắt công tắc.' : 'Hệ thống tự sinh, không nhập tay.'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 w-1/3">
                  {isReadonly ? (
                    <div className="w-full min-h-11 px-3 py-2 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 text-center font-bold flex items-center justify-center">
                      <span className={cf.value ? '' : 'text-slate-500 text-xs'}>{cf.value || 'Hệ thống tự điền'}</span>
                    </div>
                  ) : isBoolean ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={cf.value === 'true'}
                      onClick={() => handleUpdate(cf.key, cf.value === 'true' ? 'false' : 'true')}
                      className={`relative h-9 w-20 rounded-full p-1 transition ${
                        cf.value === 'true' ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`block h-7 w-7 rounded-full bg-white shadow transition ${
                          cf.value === 'true' ? 'translate-x-11' : 'translate-x-0'
                        }`}
                      />
                      <span className="sr-only">{cf.value === 'true' ? 'Bật' : 'Tắt'}</span>
                    </button>
                  ) : (
                    <input
                      type={cf.kieu_du_lieu === 'number' || cf.kieu_du_lieu === 'NUMBER' ? 'number' : 'text'}
                      defaultValue={cf.value}
                      onBlur={(e) => {
                        if (e.target.value !== cf.value) handleUpdate(cf.key, e.target.value);
                      }}
                      className="w-full p-2 border border-slate-300 rounded-lg text-center font-bold focus:ring-2 focus:ring-primary outline-none"
                    />
                  )}
                  <span className="text-xs text-slate-400 font-mono">[{cf.kieu_du_lieu}]</span>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={autoCloseTarget !== null}
        onClose={() => setAutoCloseTarget(null)}
        onConfirm={requestAutoCloseChange}
        title={`${autoCloseTarget ? 'Bật' : 'Tắt'} tự sinh OUT`}
        message={`Thay đổi này sẽ có hiệu lực từ ngày ${effectiveDisplay}. Trước mốc đó hệ thống vẫn dùng trạng thái hiện tại; khi đến ngày hiệu lực, các IN thiếu OUT đủ điều kiện sẽ được chốt trước khi áp dụng trạng thái mới.`}
        confirmText="Lên lịch áp dụng"
        cancelText="Quay lại"
        type={autoCloseTarget ? 'info' : 'warning'}
        isLoading={savingAutoClose}
      />
    </>
  );
}

// ----------------------------------------------------
// TAB 3: XUẤT EXCEL
// ----------------------------------------------------
function ExportTab() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const downloadAll = () => {
    if (!month) return alert('Chọn tháng xuất báo cáo!');
    window.open(`/api/export-excel?khoa=ALL&month=${month}`, '_blank');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <header className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold font-outfit text-slate-800">Trung Tâm Xuất Báo Cáo Excel</h2>
        <p className="text-sm text-slate-500 mt-1">Hệ thống tổng hợp chuẩn định dạng BCC, tự nhận diện vắt ca và tự bù ký hiệu phép.</p>
      </header>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
        <div>
          <label className="block text-sm font-bold text-slate-600 mb-2 uppercase">Chọn Tháng Báo Cáo</label>
          <input 
            type="month" 
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="p-3 border border-slate-300 rounded-lg w-full outline-none focus:border-primary"
          />
        </div>
        
        <div className="bg-blue-50 text-blue-800 text-sm p-4 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0" size={16} />
          <p>Thuật toán tự động chèn <b>+</b> (Đi làm), <b>TR</b> (Trực) và <b>những ký hiệu phép</b> tương ứng, đồng thời xử lý luật ưu tiên ĐI LÀM lớn hơn NGHỈ PHÉP (Người dùng checkin thực tế ghi đè Bot).</p>
        </div>

        <button onClick={downloadAll} className="w-full btn-primary py-4 text-lg font-bold flex items-center justify-center gap-3">
           <FileSpreadsheet size={24} /> Tải Ngay Bảng Công Toàn Viện
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// TAB 4: GIÁM SÁT GIAN LẬN
// ----------------------------------------------------
function FraudTab() {
  const [subTab, setSubTab] = useState<FraudSubTab>('SO_DEN');

  // ── Sub-tab 1: Sổ Đen ──────────────────────────────────────────────
  const [fraudSummary, setFraudSummary] = useState<FraudSummaryItem[]>([]);
  const [loadingFraud, setLoadingFraud] = useState(true);
  const [searchFraud, setSearchFraud] = useState('');
  const [filterKhoaFraud, setFilterKhoaFraud] = useState('ALL');
  const [periodFraud, setPeriodFraud] = useState<'week' | 'month' | 'quarter'>('month');

  const fetchFraudSummary = async (p: 'week' | 'month' | 'quarter', showLoading = true) => {
    if (showLoading) setLoadingFraud(true);
    try {
      const response = await fetch(`/api/admin/fraud-summary?period=${p}`);
      const data = await response.json() as FraudSummaryItem[];
      setFraudSummary(Array.isArray(data) ? data : []);
    } catch {
      setFraudSummary([]);
    } finally {
      setLoadingFraud(false);
    }
  };

  // ── Sub-tab 2: Manager ─────────────────────────────────────────────
  const [managerFrauds, setManagerFrauds] = useState<ManagerFraudResponse>({ recent: [], summary: [] });
  const [loadingManager, setLoadingManager] = useState(true);
  const [searchManager, setSearchManager] = useState('');
  const [selectedManagerKey, setSelectedManagerKey] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchFraudSummary('month', false);
    });
    fetch('/api/admin/manager-fraud')
      .then(r => r.json())
      .then((data: ManagerFraudResponse) => {
        setManagerFrauds(data);
        setSelectedManagerKey(data.summary?.[0]?.key ?? null);
        setLoadingManager(false);
      })
      .catch(() => setLoadingManager(false));
  }, []);

  // ── Filter logic ───────────────────────────────────────────────────
  const khoasFraud = Array.from(new Set(fraudSummary.map(f => f.khoa).filter(Boolean)));
  const filteredFraud = fraudSummary.filter(f => {
    const matchSearch = !searchFraud ||
      f.ma_nv.toLowerCase().includes(searchFraud.toLowerCase()) ||
      f.ho_ten.toLowerCase().includes(searchFraud.toLowerCase());
    const matchKhoa = filterKhoaFraud === 'ALL' || f.khoa === filterKhoaFraud;
    return matchSearch && matchKhoa;
  });

  const selectedManager = managerFrauds.summary.find((s) => s.key === selectedManagerKey) ?? null;
  const filteredManager = managerFrauds.recent.filter(r => {
    const matchSelection = selectedManager
      ? r.ho_tro_boi === selectedManager.manager && r.khoa === selectedManager.khoa
      : true;
    const matchSearch = !searchManager ||
      (r.ho_ten ?? '').toLowerCase().includes(searchManager.toLowerCase()) ||
      (r.ma_nv ?? '').toLowerCase().includes(searchManager.toLowerCase());
    return matchSelection && matchSearch;
  });

  // Group fraudSummary by khoa
  const groupedByKhoa = filteredFraud.reduce<Record<string, FraudSummaryItem[]>>((acc, item) => {
    const k = item.khoa || 'Không rõ';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <header className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold font-outfit text-red-600 flex items-center gap-2">
          <ShieldAlert /> Giám Sát Hành Vi Bất Thường
        </h2>
        <p className="text-sm text-slate-500 mt-1">Sổ đen gian lận thiết bị và theo dõi tần suất can thiệp tay của Trưởng Khoa.</p>
      </header>

      {/* Sub-tab switcher */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setSubTab('SO_DEN')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            subTab === 'SO_DEN' ? 'bg-white shadow text-red-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >🚨 Sổ Đen Gian Lận</button>
        <button
          onClick={() => setSubTab('MANAGER')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            subTab === 'MANAGER' ? 'bg-white shadow text-amber-600' : 'text-slate-500 hover:text-slate-700'
          }`}
        >⚠️ Can Thiệp Manager</button>
      </div>

      {/* ── SUB-TAB 1: SỔ ĐEN ─────────────────────────────────────── */}
      {subTab === 'SO_DEN' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <input
              type="text"
              placeholder="Tìm theo Tên hoặc Mã NV..."
              value={searchFraud}
              onChange={e => setSearchFraud(e.target.value)}
              className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary w-56 text-sm"
            />
            <select
              value={filterKhoaFraud}
              onChange={e => setFilterKhoaFraud(e.target.value)}
              className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary text-sm"
            >
              <option value="ALL">-- Tất cả Khoa --</option>
              {khoasFraud.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <div className="flex gap-1 ml-auto">
              {(['week', 'month', 'quarter'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => { setPeriodFraud(p); void fetchFraudSummary(p); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    periodFraud === p ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p === 'week' ? 'Tuần' : p === 'month' ? 'Tháng' : 'Quý'}
                </button>
              ))}
            </div>
          </div>

          {loadingFraud ? (
            <p className="text-center text-slate-500 py-8">Đang tải...</p>
          ) : Object.keys(groupedByKhoa).length === 0 ? (
            <p className="text-slate-500 bg-slate-50 p-6 rounded-xl text-center">✅ Không có bản ghi vi phạm trong khoảng thời gian này.</p>
          ) : (
            Object.entries(groupedByKhoa).map(([khoa, items]) => (
              <div key={khoa} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-red-50 border-b border-red-100 px-4 py-2">
                  <h4 className="font-bold text-red-700 text-sm">📍 {khoa} — {items.length} nhân viên</h4>
                </div>
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3">Mã NV</th>
                      <th className="px-4 py-3">Họ Tên</th>
                      <th className="px-4 py-3">Lỗi vi phạm</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map(item => (
                      <tr key={item.ma_nv} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.ma_nv}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{item.ho_ten}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{item.loi_vi_pham || '---'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── SUB-TAB 2: MANAGER ─────────────────────────────────────── */}
      {subTab === 'MANAGER' && (
        <div className="space-y-4">
          <div className="flex gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <input
              type="text"
              placeholder="Tìm theo Tên hoặc Mã NV..."
              value={searchManager}
              onChange={e => setSearchManager(e.target.value)}
              className="p-2 border border-slate-300 rounded-lg outline-none focus:border-primary w-56 text-sm"
            />
          </div>

          {loadingManager ? (
            <p className="text-center text-slate-500 py-8">Đang tải...</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bảng thống kê Manager */}
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
                  <h4 className="font-bold text-amber-700 text-sm uppercase">Tổng Lượt Can Thiệp Tay</h4>
                </div>
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs">
                    <tr><th className="p-3">Manager</th><th className="p-3">Khoa</th><th className="p-3 text-center">Số lượt</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {managerFrauds.summary.length === 0 && (
                      <tr><td colSpan={3} className="p-4 text-center text-slate-500">Không có dữ liệu.</td></tr>
                    )}
                    {managerFrauds.summary.map(s => (
                      <tr
                        key={s.key}
                        onClick={() => setSelectedManagerKey(s.key)}
                        className={`cursor-pointer transition ${
                          selectedManagerKey === s.key ? 'bg-amber-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-3 font-bold text-slate-800">{s.manager}</td>
                        <td className="p-3 text-slate-600">{s.khoa}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            s.count >= 5 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>{s.count}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Lịch sử gần đây */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
                  <h4 className="font-bold text-slate-600 text-sm uppercase">
                    Lịch Sử Can Thiệp Gần Đây
                    {selectedManager && (
                      <span className="ml-2 normal-case text-xs text-slate-400">
                        {selectedManager.khoa} / {selectedManager.manager}
                      </span>
                    )}
                  </h4>
                </div>
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr><th className="p-3">Nhân viên</th><th className="p-3">Thời gian</th><th className="p-3">Loại ca</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredManager.length === 0 && (
                        <tr><td colSpan={3} className="p-4 text-center text-slate-500">Trống</td></tr>
                      )}
                      {filteredManager.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="p-3">
                            <p className="font-bold text-slate-700">{r.ho_ten}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{r.ma_nv}</p>
                          </td>
                          <td className="p-3 text-slate-600">{r.thoi_gian ? new Date(r.thoi_gian).toLocaleString('vi-VN') : '--'}</td>
                          <td className="p-3"><span className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-1 rounded font-bold">{r.loai_ca}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// TAB 5: LUÂN CHUYỂN NHÂN VIÊN (MỚI - V2)
// TCCB chỉ nhập 4 trường: NV, Khoa đến, Cơ sở đến, Thời gian
// Hệ thống tự tra cơ sở nguồn, loại trực, và hiển thị Tab xác nhận
// ----------------------------------------------------
interface RotationTabProps {
  initialTargetEmp?: string | null;
}

function RotationTab({ initialTargetEmp }: RotationTabProps) {
  const [form, setForm] = useState({ ma_nv: initialTargetEmp || '', ma_khoa_dich: '', ma_co_so_dich: '', tu_ngay: '', den_ngay: '' });
  const [khoas, setKhoas] = useState<KhoaOption[]>([]);
  const [coSos, setCoSos] = useState<CoSoOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<RotationPreview | null>(null); // Dữ liệu tab xác nhận
  const [step, setStep] = useState<'form' | 'preview' | 'done'>('form');
  const [history, setHistory] = useState<RotationHistory[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initialTargetEmp) {
        setForm(f => ({ ...f, ma_nv: initialTargetEmp }));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialTargetEmp]);

  // Fetch danh mục qua API backend (bypass RLS)
  useEffect(() => {
    fetch('/api/admin/data?type=khoas')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setKhoas(data as KhoaOption[]); })
      .catch(() => {});
    fetch('/api/admin/data?type=co_so')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCoSos(data as CoSoOption[]); })
      .catch(() => {});
    fetch('/api/admin/rotation?type=LUAN_CHUYEN&limit=20')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setHistory(data as RotationHistory[]); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/rotation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, preview_only: true })
      });
      const data = (await res.json()) as { preview?: RotationPreview; error?: string };
      if (res.ok) {
        if (data.preview) setPreview(data.preview);
        setStep('preview');
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } catch { alert('Lỗi kết nối.'); }
    setLoading(false);
  };

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/rotation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setStep('done');
        fetch('/api/admin/rotation?type=LUAN_CHUYEN&limit=20')
          .then(r => r.json())
          .then(data => { if (Array.isArray(data)) setHistory(data as RotationHistory[]); })
          .catch(() => {});
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } catch { alert('Lỗi kết nối.'); }
    setSubmitting(false);
  };

  const loaiTrucLabel: Record<string, string> = {
    HANH_CHINH: 'Hành Chính', TRUC_12_24: 'Trực 12/24', TRUC_16_24: 'Trực 16/24',
    TRUC_24_24: 'Trực 24/24', '3CA_4KIP': '3 Ca 4 Kíp',
    CA_SANG_3KIP: '3 Ca 4 Kíp', CA_CHIEU_3KIP: '3 Ca 4 Kíp', CA_DEM_3KIP: '3 Ca 4 Kíp'
  };

  if (step === 'preview' && preview) return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <header className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold font-outfit text-slate-800 flex items-center gap-2">
          <ArrowRightLeft /> Xác Nhận Lệnh Luân Chuyển
        </h2>
        <p className="text-sm text-slate-500 mt-1">Vui lòng kiểm tra kỹ thông tin trước khi gửi lệnh tới hai khoa.</p>
      </header>
      <div className="bg-white rounded-xl border-2 border-indigo-200 shadow p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-slate-50 p-3 rounded-lg"><p className="text-slate-400 text-xs uppercase font-bold">Nhân viên</p><p className="font-bold text-slate-800 mt-1">{preview.ho_ten} ({preview.ma_nv})</p></div>
          <div className="bg-slate-50 p-3 rounded-lg"><p className="text-slate-400 text-xs uppercase font-bold">Thời gian</p><p className="font-bold text-slate-800 mt-1">{preview.tu_ngay} → {preview.den_ngay}</p></div>
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
            <p className="text-blue-400 text-xs uppercase font-bold">Khoa / Cơ Sở Nguồn</p>
            <p className="font-bold text-blue-700 mt-1">{preview.khoa_nguon}</p>
            <p className="text-blue-500 text-xs">{preview.co_so_nguon}</p>
          </div>
          <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
            <p className="text-indigo-400 text-xs uppercase font-bold">Khoa / Cơ Sở Đến</p>
            <p className="font-bold text-indigo-700 mt-1">{preview.khoa_dich}</p>
            <p className="text-indigo-500 text-xs">{preview.co_so_dich}</p>
          </div>
        </div>
        <div className={`p-3 rounded-lg border text-sm ${preview.canh_bao_loai_truc ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className="font-bold">{preview.canh_bao_loai_truc ? '⚠️ Tự động điều chỉnh loại trực' : '✅ Loại trực giữ nguyên'}</p>
          <p className="text-xs mt-1">
            {loaiTrucLabel[preview.loai_truc_cu]} → <b>{loaiTrucLabel[preview.loai_truc_moi]}</b>
            {preview.canh_bao_loai_truc && ' (Khoa đến không hỗ trợ loại trực cũ, hệ thống tự chuyển về loại phù hợp mặc định của khoa đến)'}
          </p>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={() => setStep('form')} className="flex-1 py-3 border border-slate-300 rounded-lg font-bold text-slate-600 hover:bg-slate-50">← Quay lại sửa</button>
          <button
            disabled={submitting}
            onClick={() => void handleConfirmSubmit()}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition disabled:opacity-60"
          >
            {submitting ? 'Đang gửi...' : 'Xác nhận gửi lệnh ✓'}
          </button>
        </div>
      </div>
    </div>
  );

  if (step === 'done') return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <CheckCircle2 size={64} className="text-emerald-500" />
      <h3 className="text-2xl font-bold">Đã gửi lệnh thành công!</h3>
      <p className="text-slate-500">Lệnh đang chờ hai Khoa xác nhận trên Dashboard của họ.</p>
      <button onClick={() => { setStep('form'); setPreview(null); setForm({ ma_nv: '', ma_khoa_dich: '', ma_co_so_dich: '', tu_ngay: '', den_ngay: '' }); }} className="btn-primary px-8">Tạo lệnh mới</button>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <header className="border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold font-outfit text-slate-800 flex items-center gap-2"><ArrowRightLeft /> Tạo Lệnh Luân Chuyển Nhân Viên</h2>
        <p className="text-sm text-slate-500 mt-1">Sau khi gửi, hai khoa liên quan sẽ nhận được lệnh và bấm xác nhận trên Dashboard của họ.</p>
      </header>
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mã Nhân Viên *</label>
          <input required value={form.ma_nv} onChange={e => setForm(f => ({...f, ma_nv: e.target.value}))} placeholder="VD: NV001" className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-400" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Khoa Đến *</label>
            <select required value={form.ma_khoa_dich} onChange={e => setForm(f => ({...f, ma_khoa_dich: e.target.value}))} className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-400">
              <option value="">-- Chọn khoa --</option>
              {khoas.map(k => <option key={k.ma_khoa} value={k.ma_khoa}>{k.ten_khoa || k.ma_khoa}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cơ Sở Đến (mặc định: giữ nguyên)</label>
            <select value={form.ma_co_so_dich} onChange={e => setForm(f => ({...f, ma_co_so_dich: e.target.value}))} className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-400">
              <option value="">-- Cùng cơ sở --</option>
              {coSos.map(c => <option key={c.ma_co_so} value={c.ma_co_so}>{c.ten_co_so || c.ma_co_so}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Từ Ngày *</label>
            <input required type="date" value={form.tu_ngay} onChange={e => setForm(f => ({...f, tu_ngay: e.target.value}))} className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Đến Ngày (bỏ trống = vô thời hạn)</label>
            <input type="date" value={form.den_ngay} onChange={e => setForm(f => ({...f, den_ngay: e.target.value}))} className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:border-indigo-400" />
          </div>
        </div>
        <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-lg border border-blue-100">
          <b>Lưu ý:</b> Hệ thống sẽ tự tra Khoa nguồn và Cơ sở nguồn của nhân viên. TCCB không cần nhập. Loại trực sẽ được tự động kiểm tra tương thích.
        </div>
        <button disabled={loading} type="submit" className="w-full btn-primary py-3 font-bold text-base">
          {loading ? 'Đang xử lý...' : 'Tiếp tục → Xem Xác Nhận'}
        </button>
      </form>

      {history.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-600 mb-3 text-sm uppercase">Lịch sử lệnh gần đây</h3>
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-white border border-slate-100 rounded-lg p-3 flex items-center justify-between text-sm">
                <span className="font-medium">{h.ho_ten} ({h.ma_nv}) → {h.ma_khoa_dich}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${h.trang_thai === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{h.trang_thai}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// TAB 6: KIỂM TRA ĐỘT XUẤT (SNAPSHOT)
// ----------------------------------------------------
interface RandomCheckTabProps {
  queue?: string[];
}

function RandomCheckTab({ queue = [] }: RandomCheckTabProps) {
  const [ids, setIds] = useState(queue.join(', '));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RandomCheckResult[]>([]);
  const [isStarted, setIsStarted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queue.length > 0 && !isStarted) {
        setIds(queue.join(', '));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queue, isStarted]);

  const fetchResults = async () => {
    try {
      const res = await fetch('/api/admin/random-check'); 
      const data = (await res.json()) as unknown;
      if (Array.isArray(data)) {
        setResults(data as RandomCheckResult[]);
        if (data.length > 0) setIsStarted(true);
      }
    } catch {}
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchResults(); // Check if a session already exists
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isStarted) {
      interval = setInterval(fetchResults, 5000); // Poll mỗi 5s
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStarted]);

  const handleStart = async () => {
    if (!ids.trim()) return alert('Dán danh sách mã nhân viên');
    setLoading(true);
    const idList = ids.split(/[\n, ]+/).filter(x => x.trim());
    try {
      const res = await fetch('/api/admin/random-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: idList })
      });
      if (res.ok) {
        setIsStarted(true);
        setIds('');
        fetchResults();
      } else {
        alert('Lỗi khởi tạo');
      }
    } catch { alert('Lỗi kết nối'); }
    setLoading(false);
  };

  const handleEnd = async () => {
    if (!confirm('Kết thúc sẽ xóa toàn bộ dữ liệu kiểm tra đột xuất này. Bạn chắc chắn chứ?')) return;
    try {
      const res = await fetch('/api/admin/random-check', { method: 'DELETE' });
      if (res.ok) {
        setIsStarted(false);
        setResults([]);
      }
    } catch { alert('Lỗi khi dọn dẹp'); }
  };

  const copyLink = (token: string) => {
    const link = `${window.location.origin}/check-in/random/${token}`;
    navigator.clipboard.writeText(link);
    alert('Đã copy link gửi cho nhân viên!');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="border-b border-slate-200 pb-4 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold font-outfit text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-red-500" /> Kiểm Tra Đột Xuất (Snap-check)
          </h2>
          <p className="text-sm text-slate-500 mt-1">Dán danh sách mã nhân viên để bắt đầu phiên kiểm tra tức thời.</p>
        </div>
        {isStarted && (
          <button onClick={handleEnd} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold transition flex items-center gap-2">
            Kết Thúc & Xóa Toàn Bộ Dữ Liệu
          </button>
        )}
      </header>

      {!isStarted ? (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <label className="block text-sm font-bold text-slate-600 uppercase">Dán danh sách mã nhân viên (cách nhau bởi dấu phẩy, khoảng trắng hoặc xuống dòng)</label>
          <textarea 
            rows={5} 
            value={ids}
            onChange={e => setIds(e.target.value)}
            placeholder="VD: NV001, NV002, NV003..."
            className="w-full p-4 border border-slate-200 rounded-lg outline-none focus:border-red-400 font-mono"
          />
          <button 
            disabled={loading} 
            onClick={handleStart}
            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-slate-800 transition"
          >
            {loading ? 'Đang tạo phiên...' : 'Bắt Đầu Kiểm Tra Đột Xuất'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-emerald-800 text-sm">
            <b>Phiên kiểm tra đang diễn ra.</b> Hãy copy link ở cột cuối cùng và gửi cho từng nhân viên tương ứng.
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-[10px] font-bold">
                <tr>
                  <th className="px-6 py-3">Nhân viên</th>
                  <th className="px-6 py-3">Snapshot (Khoa/Cơ Sở)</th>
                  <th className="px-6 py-3">Trạng thái dự kiến</th>
                  <th className="px-6 py-3">Kết quả phản hồi</th>
                  <th className="px-6 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-800">{r.ho_ten}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{r.ma_nv}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-medium">{r.khoa_hien_tai}</p>
                      <p className="text-[10px] text-slate-500 italic">{r.co_so_hien_tai}</p>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600">{r.trang_thai_du_kien}</td>
                    <td className="px-6 py-4">
                      {r.trang_thai === 'COMPLETED' ? (
                        <div className="flex items-center gap-3">
                           {r.link_anh_mat && (
                             <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-white shadow-sm">
                               <Image
                                 src={r.link_anh_mat}
                                 alt={`snapshot-${r.ma_nv}`}
                                 fill
                                 sizes="40px"
                                 className="object-cover"
                                 unoptimized
                               />
                             </div>
                           )}
                           <div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${r.is_match_gps ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {r.is_match_gps ? 'ĐÚNG VỊ TRÍ' : 'SAI VỊ TRÍ'}
                              </span>
                              <p className="text-[9px] text-slate-400 mt-1">{r.thoi_gian_phan_hoi ? new Date(r.thoi_gian_phan_hoi).toLocaleTimeString() : '--:--:--'}</p>
                           </div>
                        </div>
                      ) : (
                        <span className="text-amber-500 animate-pulse font-bold text-[10px]">ĐANG CHỜ...</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.trang_thai === 'PENDING' && (
                        <button onClick={() => copyLink(r.token)} className="text-indigo-600 hover:text-indigo-800 font-bold text-xs flex items-center gap-1 justify-end ml-auto">
                          <ArrowRightLeft size={14} /> Copy Link
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

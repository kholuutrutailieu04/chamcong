'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  getDaysInMonth, 
  getCurrentMonthLabel, 
  translateAttendanceSymbol 
} from '@/lib/utils';
import { 
  CalendarDays, 
  UserCircle, 
  ArrowLeft, 
  Loader2,
  Info
} from 'lucide-react';

type AttendanceRecord = {
  id: string;
  thoi_gian: string | null;
  loai_ca: string | null;
  ghi_chu: string | null;
  in_record_id: string | null;
};

/**
 * Trạng thái hiển thị cho 1 ô ngày:
 * - 'PENDING_LAM'  → chữ "in"  (màu xanh lá nhạt) — đã vào làm, chưa ra
 * - 'PENDING_TRUC' → chữ "in·" (màu xanh dương nhạt) — đã vào trực, chưa ra
 * - 'DONE_LAM'     → chữ "+"   (xanh lá đậm)
 * - 'DONE_TRUC'    → chữ "TR"  (xanh dương đậm)
 * - symbol khác    → ký hiệu nghỉ phép, học tập...
 */
type DayCellState =
  | { kind: 'PENDING_LAM' }
  | { kind: 'PENDING_TRUC' }
  | { kind: 'DONE_LAM' }
  | { kind: 'DONE_TRUC' }
  | { kind: 'OTHER'; symbol: string }
  | { kind: 'EMPTY' };

function buildDayCellMap(records: AttendanceRecord[]): Record<number, DayCellState> {
  const result: Record<number, DayCellState> = {};

  // Tập hợp các IN_RECORD_ID đã có OUT tương ứng
  const completedInIds = new Set<string>();
  records.forEach((r) => {
    if (r.loai_ca === 'OUT' && r.in_record_id) {
      completedInIds.add(r.in_record_id);
    }
  });

  // Xử lý từng record, theo thứ tự thời gian (đã sort ascending từ API)
  records.forEach((r) => {
    if (!r.thoi_gian || !r.loai_ca) return;
    if (r.loai_ca === 'OUT') return; // Bỏ qua OUT — đã xử lý qua completedInIds

    const day = new Date(r.thoi_gian).getDate();

    if (r.loai_ca === 'IN_LAM') {
      const isDone = completedInIds.has(r.id);
      // Nếu ngày này đã có trạng thái hoàn tất (DONE_TRUC) thì không ghi đè
      if (result[day]?.kind === 'DONE_TRUC') return;
      result[day] = isDone ? { kind: 'DONE_LAM' } : { kind: 'PENDING_LAM' };
      return;
    }

    if (r.loai_ca === 'IN_TRUC') {
      const isDone = completedInIds.has(r.id);
      // Ưu tiên DONE > PENDING, ưu tiên TRUC > LAM
      if (result[day]?.kind === 'DONE_LAM' || result[day]?.kind === 'DONE_TRUC') {
        if (isDone) result[day] = { kind: 'DONE_TRUC' };
        return;
      }
      result[day] = isDone ? { kind: 'DONE_TRUC' } : { kind: 'PENDING_TRUC' };
      return;
    }

    // Các loại ca khác (NGHI_PHEP, DI_HOC, CONG_TAC, ...) chỉ ghi nếu ngày chưa có dữ liệu chấm công chính
    const currentKind = result[day]?.kind;
    const hasPrimary = currentKind === 'DONE_LAM' || currentKind === 'DONE_TRUC'
      || currentKind === 'PENDING_LAM' || currentKind === 'PENDING_TRUC';
    if (!hasPrimary) {
      result[day] = { kind: 'OTHER', symbol: translateAttendanceSymbol(r.loai_ca) };
    }
  });

  return result;
}

function renderCellContent(state: DayCellState): { text: string; className: string } {
  switch (state.kind) {
    case 'PENDING_LAM':
      return {
        text: 'in',
        className: 'text-emerald-400 text-sm font-bold italic',
      };
    case 'PENDING_TRUC':
      return {
        text: 'in·',
        className: 'text-blue-400 text-sm font-bold italic',
      };
    case 'DONE_LAM':
      return {
        text: '+',
        className: 'text-emerald-600 text-xl font-black',
      };
    case 'DONE_TRUC':
      return {
        text: 'TR',
        className: 'text-blue-600 text-lg font-black',
      };
    case 'OTHER':
      return {
        text: state.symbol,
        className: 'text-slate-700 text-base font-bold',
      };
    case 'EMPTY':
    default:
      return { text: '.', className: 'text-slate-200' };
  }
}

export default function EmployeeDashboard() {
  const router = useRouter();
  const [empInfo] = useState<{ma_nv: string, ho_ten: string} | null>(() => {
    if (typeof window === 'undefined') return null;
    const ma_nv = localStorage.getItem('employee_ma_nv');
    const ho_ten = localStorage.getItem('employee_ho_ten');
    if (!ma_nv) return null;
    return { ma_nv, ho_ten: ho_ten || '' };
  });
  const [dayCells, setDayCells] = useState<Record<number, DayCellState>>({});
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number[]>([]);

  useEffect(() => {
    const ma_nv = empInfo?.ma_nv;
    if (!ma_nv) {
      router.push('/employee/login');
      return;
    }

    const fetchAttendance = async () => {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

      setDays(getDaysInMonth(currentMonth, currentYear));

      const res = await fetch(`/api/employee/attendance?ma_nv=${encodeURIComponent(ma_nv)}&month=${monthStr}`);

      if (!res.ok) {
        localStorage.clear();
        router.push('/employee/login');
        return;
      }

      const json = await res.json() as { records: AttendanceRecord[] };
      setDayCells(buildDayCellMap(json.records ?? []));
      setLoading(false);
    };

    const timer = setTimeout(() => {
      void fetchAttendance();
    }, 0);

    return () => clearTimeout(timer);
  }, [empInfo?.ma_nv, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-bg-main p-6 lg:p-12 animate-fade-in">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Navigation & User Profile */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                localStorage.clear();
                router.push('/employee/login');
              }}
              className="p-3 glass rounded-xl hover:bg-white/50 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <p className="text-text-muted text-xs font-bold uppercase tracking-wider mb-1">Tra cứu cá nhân</p>
              <h1 className="text-3xl font-bold font-outfit uppercase">{empInfo?.ho_ten}</h1>
            </div>
          </div>
          <div className="glass px-6 py-4 rounded-2xl flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-full text-primary">
              <UserCircle size={24} />
            </div>
            <div>
              <p className="text-[10px] text-text-muted font-bold uppercase">Mã Nhân Viên</p>
              <p className="font-mono font-bold">{empInfo?.ma_nv}</p>
            </div>
          </div>
        </div>

        {/* BCC View-only Card */}
        <section className="glass rounded-3xl overflow-hidden shadow-xl border border-white/50">
          <div className="p-6 bg-white/50 border-b border-glass-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarDays className="text-primary" size={24} />
              <h2 className="text-xl font-bold font-outfit">{getCurrentMonthLabel()}</h2>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted uppercase tracking-tighter sm:tracking-normal">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              Ghi nhận từ hệ thống
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[800px] p-6 lg:p-8">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {days.map(day => (
                      <th 
                        key={day} 
                        className="p-2 border border-glass-border bg-slate-50 text-[10px] sm:text-xs font-bold text-slate-500 w-[max(3%,30px)]"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-primary/5 transition-colors">
                    {days.map(day => {
                      const state = dayCells[day] ?? { kind: 'EMPTY' };
                      const { text, className } = renderCellContent(state);
                      return (
                        <td 
                          key={day} 
                          className="p-2 border border-glass-border text-center h-12 lg:h-16"
                          title={
                            state.kind === 'PENDING_LAM' ? 'Đã vào làm — chưa check-out'
                            : state.kind === 'PENDING_TRUC' ? 'Đã vào trực — chưa check-out'
                            : undefined
                          }
                        >
                          <span className={className}>{text}</span>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>

              {/* Legend */}
              <div className="mt-8 flex flex-wrap gap-3 items-center justify-center p-4 border border-glass-border/40 rounded-2xl bg-white/30">
                <LegendItem symbol="+" label="Lương thời gian" className="text-emerald-600 font-black text-xl" />
                <LegendItem symbol="TR" label="Trực" className="text-blue-600 font-black text-lg" />
                <LegendItem symbol="in" label="Chờ check-out (HC)" className="text-emerald-400 italic text-sm font-bold" />
                <LegendItem symbol="in·" label="Chờ check-out (Trực)" className="text-blue-400 italic text-sm font-bold" />
                <LegendItem symbol="P" label="Nghỉ phép" className="text-slate-700 font-bold" />
                <LegendItem symbol="NB" label="Nghỉ bù" className="text-purple-600 font-bold" />
                <LegendItem symbol="Ô" label="Nghỉ ốm" className="text-slate-700 font-bold" />
                <LegendItem symbol="H" label="Học tập" className="text-slate-700 font-bold" />
              </div>
            </div>
          </div>
        </section>

        {/* Bottom Banner */}
        <div className="flex items-start gap-3 p-6 bg-primary/5 rounded-2xl border border-primary/10">
          <Info className="text-primary flex-shrink-0" size={20} />
          <p className="text-xs text-text-muted leading-relaxed">
            <b>Lưu ý:</b> Ký hiệu <b className="text-emerald-400 italic">in</b> / <b className="text-blue-400 italic">in·</b> nghĩa là bạn đã quét vào nhưng <b>chưa quét ra</b>. 
            Sau khi quét ra thành công, ký hiệu sẽ tự động chuyển thành <b className="text-emerald-600">+</b> hoặc <b className="text-blue-600">TR</b>. 
            Bảng này chỉ xem (View-only), mọi yêu cầu chỉnh sửa liên hệ Trưởng khoa.
          </p>
        </div>
      </div>
    </main>
  );
}

function LegendItem({ symbol, label, className }: { symbol: string; label: string; className?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-white/50 rounded-lg border border-glass-border">
      <span className={className ?? 'font-bold text-primary'}>{symbol}</span>
      <span className="text-[10px] text-text-muted uppercase font-bold">{label}</span>
    </div>
  );
}

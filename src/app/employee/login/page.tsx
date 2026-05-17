'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, LogIn, AlertCircle, Loader2, Mail, ShieldCheck } from 'lucide-react';

type LoginStep = 'ENTER_ID' | 'ENTER_EMAIL' | 'ENTER_OTP' | 'FRAUD_WARNING';

async function getDeviceId(): Promise<string> {
  const nav = window.navigator;
  const screen = window.screen;
  const raw = [
    nav.userAgent,
    nav.language,
    nav.hardwareConcurrency,
    screen.colorDepth,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');

  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Thiết bị không xác định';
}

export default function EmployeeLogin() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-bg-main flex items-center justify-center p-4">
        <Loader2 className="animate-spin text-primary" size={40} />
      </main>
    }>
      <EmployeeLoginClient />
    </Suspense>
  );
}

function EmployeeLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<LoginStep>('ENTER_ID');
  const [empId, setEmpId] = useState(searchParams.get('emp_id') || '');
  const [email1, setEmail1] = useState('');
  const [email2, setEmail2] = useState('');
  const [otp, setOtp] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [fraudWarning, setFraudWarning] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const handleEnterEmpId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId.trim() || !deviceId) return;
    setLoading(true);
    setError('');

    try {
      const currentMaNv = empId.trim();
      const res = await fetch('/api/employee/device-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ma_nv: currentMaNv, device_id: deviceId }),
      });
      const data = await res.json() as {
        status: 'TRUSTED' | 'NEW_DEVICE' | 'SHARED_DEVICE_FRAUD';
        has_email: boolean;
        other_ma_nv?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? 'Có lỗi xảy ra.');
        setLoading(false);
        return;
      }

      if (data.status === 'TRUSTED') {
        localStorage.setItem('employee_ma_nv', currentMaNv);
        const redirect = searchParams.get('redirect');
        router.push(redirect === 'attendance' ? '/attendance' : '/employee/dashboard');
        return;
      }

      if (data.status === 'SHARED_DEVICE_FRAUD') {
        setFraudWarning(
          'Cảnh báo: Thiết bị này đã được đăng ký bởi một nhân viên khác. Hệ thống sẽ ghi nhận hành vi này.',
        );
      }

      if (data.has_email) {
        const sendRes = await fetch('/api/employee/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ma_nv: currentMaNv, device_id: deviceId }),
        });
        const sendData = await sendRes.json() as { error?: string };
        if (!sendRes.ok) {
          setError(sendData.error ?? 'Không thể gửi OTP.');
          setLoading(false);
          return;
        }
        setStep('ENTER_OTP');
      } else {
        setStep('ENTER_EMAIL');
      }
    } catch {
      setError('Lỗi kết nối máy chủ.');
    }
    setLoading(false);
  };

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (email1 !== email2) {
      setError('Hai địa chỉ email không khớp. Vui lòng nhập lại.');
      return;
    }
    setLoading(true);

    try {
      const res = await fetch('/api/employee/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ma_nv: empId.trim(), email: email1, device_id: deviceId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Không thể gửi OTP.');
        setLoading(false);
        return;
      }
      setStep('ENTER_OTP');
    } catch {
      setError('Lỗi kết nối máy chủ.');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/employee/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ma_nv: empId.trim(),
          device_id: deviceId,
          otp: otp.trim(),
          ten_thiet_bi: getDeviceName(),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Mã OTP không đúng.');
        setLoading(false);
        return;
      }

      localStorage.setItem('employee_ma_nv', empId.trim());

      if (fraudWarning) {
        setStep('FRAUD_WARNING');
        setLoading(false);
        return;
      }

      const redirect = searchParams.get('redirect');
      router.push(redirect === 'attendance' ? '/attendance' : '/employee/dashboard');
    } catch {
      setError('Lỗi kết nối máy chủ.');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-bg-main flex items-center justify-center p-4">
      <div className="glass p-8 rounded-2xl max-w-md w-full shadow-2xl space-y-8 animate-fade-in">
        {step === 'ENTER_ID' && (
          <>
            <div className="text-center space-y-2">
              <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-primary">
                <User size={32} />
              </div>
              <h1 className="text-2xl font-bold font-outfit uppercase tracking-tight">Cổng Nhân Viên</h1>
              <p className="text-text-muted text-sm px-8 leading-relaxed">Vui lòng nhập mã số nhân viên.</p>
            </div>
            <form onSubmit={handleEnterEmpId} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Mã Nhân Viên</label>
                <input
                  type="text"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value.toUpperCase())}
                  placeholder="VD: NV001"
                  className="w-full bg-white/50 border border-glass-border px-4 py-3 rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all font-medium"
                />
              </div>
              {error && <ErrorBanner message={error} />}
              <button
                type="submit"
                disabled={loading || !empId || !deviceId}
                className="btn-primary w-full py-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
                <span>TIẾP THEO</span>
              </button>
            </form>
          </>
        )}

        {step === 'ENTER_EMAIL' && (
          <>
            <div className="text-center space-y-2">
              <div className="bg-blue-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-blue-500">
                <Mail size={32} />
              </div>
              <h2 className="text-2xl font-bold font-outfit uppercase tracking-tight">Đăng Ký Email</h2>
              <p className="text-text-muted text-sm px-4 leading-relaxed">
                Đây là lần đầu đăng nhập. Vui lòng cung cấp email để nhận mã xác thực.
              </p>
            </div>
            <form onSubmit={handleSubmitEmail} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Email của bạn</label>
                <input
                  type="email"
                  value={email1}
                  onChange={(e) => setEmail1(e.target.value)}
                  placeholder="ten@benhvien.vn"
                  required
                  className="w-full bg-white/50 border border-glass-border px-4 py-3 rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                />
              </div>
              <div className="space-y-2 animate-fade-in">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Xác nhận lại email</label>
                <input
                  type="email"
                  value={email2}
                  onChange={(e) => setEmail2(e.target.value)}
                  placeholder="Nhập lại email ở trên"
                  required
                  className={`w-full bg-white/50 border px-4 py-3 rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all ${
                    email2 && email1 !== email2
                      ? 'border-red-400'
                      : email2 && email1 === email2
                        ? 'border-emerald-400 ring-1 ring-emerald-400'
                        : 'border-glass-border'
                  }`}
                />
                {email2 && email1 !== email2 && (
                  <p className="text-xs text-red-500 pl-1">Email không khớp.</p>
                )}
              </div>
              {error && <ErrorBanner message={error} />}
              <button
                type="submit"
                disabled={loading || !email1 || !email2 || email1 !== email2}
                className="btn-primary w-full py-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : email1 && email2 && email1 === email2 ? (
                  <ShieldCheck size={18} className="text-emerald-300" />
                ) : (
                  <Mail size={18} />
                )}
                <span>GỬI MÃ XÁC THỰC</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('ENTER_ID');
                  setError('');
                }}
                className="w-full text-xs text-text-muted hover:underline text-center"
              >
                Quay lại
              </button>
            </form>
          </>
        )}

        {step === 'ENTER_OTP' && (
          <>
            <div className="text-center space-y-2">
              <div className="bg-emerald-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                <ShieldCheck size={32} />
              </div>
              <h2 className="text-2xl font-bold font-outfit uppercase tracking-tight">Nhập Mã OTP</h2>
              <p className="text-text-muted text-sm px-4 leading-relaxed">
                Mã xác thực đã được gửi đến email của bạn. Có hiệu lực trong 10 phút.
              </p>
            </div>
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Mã OTP</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').substring(0, 8))}
                  placeholder="Nhập mã xác thực"
                  maxLength={8}
                  className="w-full bg-white/50 border border-glass-border px-4 py-3 rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all text-center text-2xl font-mono tracking-widest"
                />
              </div>
              {error && <ErrorBanner message={error} />}
              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="btn-primary w-full py-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                <span>XÁC NHẬN</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('ENTER_ID');
                  setError('');
                  setOtp('');
                }}
                className="w-full text-xs text-text-muted hover:underline text-center"
              >
                Quay lại
              </button>
            </form>
          </>
        )}

        {step === 'FRAUD_WARNING' && (
          <div className="text-center space-y-6">
            <div className="bg-red-500/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto text-red-500 animate-pulse">
              <AlertCircle size={40} />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-bold font-outfit text-red-600">Cảnh Báo Hệ Thống</h2>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-left space-y-2">
                <p className="text-sm text-red-800 font-semibold">
                  Hệ thống đã ghi nhận thiết bị này đang được sử dụng bởi nhiều nhân viên.
                </p>
                <p className="text-xs text-red-700 leading-relaxed">
                  Thông tin vi phạm đã được chuyển đến phòng Tổ chức Cán bộ để xem xét và xử lý theo quy định của Bệnh viện.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const redirect = searchParams.get('redirect');
                router.push(redirect === 'attendance' ? '/attendance' : '/employee/dashboard');
              }}
              className="btn-primary w-full py-3"
            >
              Đã hiểu, tiếp tục
            </button>
          </div>
        )}

        <p className="text-center text-[10px] text-text-muted italic px-4 leading-relaxed">
          * Hệ thống chấm công nội bộ của Bệnh viện Phụ sản - Nhi Đà Nẵng.
        </p>
      </div>
    </main>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-error text-xs bg-error/10 p-3 rounded-lg">
      <AlertCircle size={14} />
      <span>{message}</span>
    </div>
  );
}

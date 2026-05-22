'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Database } from '@/lib/database.types';
import {
  MapPin,
  Camera,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';

type AppStatus =
  | 'loading'      // Đang khởi tạo
  | 'gps_fail'     // Ở ngoài khuôn viên
  | 'cam_loading'  // Đang tải camera + AI
  | 'ready'        // Sẵn sàng, đang quét mặt
  | 'face_ok'      // Phát hiện khuôn mặt, sẵn sàng bấm
  | 'processing'   // Đang gửi dữ liệu
  | 'success'      // Thành công
  | 'error';       // Lỗi

type ButtonType = 'IN_LAM' | 'IN_TRUC' | 'OUT';
type ErrorAction = 'retry' | 'reload';
type AttendanceEmployee = Pick<Database['public']['Tables']['nhan_vien']['Row'], 'ho_ten' | 'khoa_phong'> & {
  dm_khoa_phong?: { ten_khoa: string } | null;
};
type SelfCorrectionState = {
  can_correct: boolean;
  record_id: string;
  current_type: 'IN_LAM' | 'IN_TRUC';
  window_minutes: number;
  minutes_since_checkin: number;
  expires_in_minutes: number;
};
type RejectedSpecialRecord = Pick<
  Database['public']['Tables']['lich_su_cham_cong']['Row'],
  'id' | 'thoi_gian' | 'loai_ca' | 'ghi_chu' | 'in_record_id'
>;

const LABEL_MAP: Record<ButtonType, { text: string; color: string }> = {
  'IN_LAM': { text: 'VÀO LÀM', color: 'bg-primary hover:bg-primary/90' },
  'IN_TRUC': { text: 'VÀO TRỰC', color: 'bg-accent hover:bg-accent/90' },
  'OUT': { text: 'RA VỀ', color: 'bg-slate-700 hover:bg-slate-600' },
};

const isIOSAndSafari = () => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIOS && isSafari;
};

const getGeoErrorCode = (err: unknown) => (
  typeof err === 'object' && err !== null && 'code' in err
    ? Number((err as GeolocationPositionError).code)
    : 0
);

const getGpsErrorState = (err: unknown): { message: string; action: ErrorAction } => {
  const errorCode = getGeoErrorCode(err);
  if (isIOSAndSafari() && errorCode === 1) {
    return {
      action: 'reload',
      message: 'Bạn đã chặn quyền vị trí. Vui lòng vào Cài đặt -> Safari -> Vị trí -> Chọn Hỏi hoặc Cho phép để tiếp tục.',
    };
  }
  if (errorCode === 2 || errorCode === 3) {
    return {
      action: 'retry',
      message: 'Không thể lấy vị trí lúc này. Vui lòng kiểm tra GPS/mạng rồi thử lại.',
    };
  }
  return {
    action: 'retry',
    message: 'Không thể lấy vị trí. Vui lòng bật GPS rồi thử lại.',
  };
};

export default function AttendancePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-bg-main flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={40} />
      </main>
    }>
      <AttendanceClient />
    </Suspense>
  );
}

function AttendanceClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlEmpId = searchParams.get('emp_id');
  const [empId, setEmpId] = useState<string | null>(urlEmpId);

  useEffect(() => {
    if (!urlEmpId) {
      const storedEmpId = localStorage.getItem('employee_ma_nv');
      if (storedEmpId) {
        setEmpId(storedEmpId);
      } else {
        router.push('/employee/login?redirect=attendance');
      }
    } else {
      setEmpId(urlEmpId);
    }
  }, [urlEmpId, router]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceApiRef = useRef<typeof import('@vladmandic/face-api') | null>(null);

  const [appStatus, setAppStatus] = useState<AppStatus>('loading');
  const [message, setMessage] = useState('Đang khởi tạo...');
  const [requiresGpsTrigger, setRequiresGpsTrigger] = useState(false);
  const [errorAction, setErrorAction] = useState<ErrorAction>('retry');
  const [employee, setEmployee] = useState<AttendanceEmployee | null>(null);
  const [showButtons, setShowButtons] = useState<ButtonType[]>([]);
  const [selfCorrection, setSelfCorrection] = useState<SelfCorrectionState | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [rejectedRecords, setRejectedRecords] = useState<RejectedSpecialRecord[]>([]);

  // ------------------------------------------------------------------
  // BƯỚC 1 & 2: GPS Check → Nếu trong khuôn viên → Bật camera
  // ------------------------------------------------------------------
  const initSystem = useCallback(async () => {
    setErrorAction('retry');
    if (!empId) {
      setAppStatus('error');
      setMessage('Mã QR không hợp lệ. Vui lòng quét lại.');
      return;
    }

    // Lấy thông tin NV & trạng thái nút hôm nay (song song)
    setMessage('Đang xác định vị trí...');

    // 1a. GPS: Lấy tọa độ
    let gpsStr = '';
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
      );
      gpsStr = `${pos.coords.latitude},${pos.coords.longitude}`;
    } catch (err: unknown) {
      const gpsError = getGpsErrorState(err);
      setAppStatus('gps_fail');
      setErrorAction(gpsError.action);
      setMessage(gpsError.message);
      return;
    }

    // 1b. Geofence check: Gọi API để kiểm tra vùng cho phép
    const geoRes = await fetch(`/api/geofence?gps=${gpsStr}`);
    const geoData = await geoRes.json();
    if (!geoData.allowed) {
      setAppStatus('gps_fail');
      setMessage(geoData.message || 'Bạn đang ở ngoài khuôn viên bệnh viện. Không thể chấm công.');
      return;
    }

    // 2. Lấy thông tin NV & trạng thái nút bấm hôm nay
    setAppStatus('cam_loading');
    setMessage('Đang tải dữ liệu nhân viên...');

    const statusRes = await fetch(`/api/attendance?emp_id=${empId}`);
    const statusData = await statusRes.json();
    setEmployee((statusData.employee as AttendanceEmployee | null) ?? null);
    setShowButtons(statusData.show_buttons ?? ['IN_LAM', 'IN_TRUC']);
    setSelfCorrection((statusData.self_correction as SelfCorrectionState | null) ?? null);
    setRejectedRecords((statusData.rejected_special as RejectedSpecialRecord[] | undefined) ?? []);

    // 3. Tải AI model + camera (song song)
    setMessage('Đang tải mô hình AI và khởi động camera...');
    let stream: MediaStream;
    try {
      const faceapi = await import('@vladmandic/face-api');
      faceApiRef.current = faceapi;
      [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } }),
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      ]);
    } catch {
      setAppStatus('error');
      setMessage('Không thể mở camera. Vui lòng cho phép quyền Camera rồi thử lại.');
      return;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await new Promise<void>(res => { videoRef.current!.onloadedmetadata = () => res(); });
    }

    setAppStatus('ready');
    setMessage('Đưa khuôn mặt vào giữa khung hình...');
  }, [empId]);

  // ------------------------------------------------------------------
  // BƯỚC 3: Vòng lặp Nhận diện khuôn mặt (chạy liên tục khi ready)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!empId) return;
    if (isIOSAndSafari()) {
      setRequiresGpsTrigger(true);
      setMessage('Nhấn nút bên dưới để bật vị trí.');
      return;
    }
    initSystem();
  }, [empId, initSystem]);

  useEffect(() => {
    if (appStatus !== 'ready' && appStatus !== 'face_ok') return;

    const interval = setInterval(async () => {
      if (!videoRef.current) return;
      const faceapi = faceApiRef.current;
      if (!faceapi) return;
      const det = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions());
      if (det) {
        setAppStatus('face_ok');
        setMessage('✅ Khuôn mặt hợp lệ. Chọn loại chấm công bên dưới.');
      } else {
        setAppStatus('ready');
        setMessage('🔍 Đang tìm khuôn mặt...');
      }
    }, 800);

    return () => clearInterval(interval);
  }, [appStatus]);

  // ------------------------------------------------------------------
  // BƯỚC 4: Gửi dữ liệu khi bấm nút
  // ------------------------------------------------------------------
  const handleAttendance = async (type: ButtonType, correctionId?: string) => {
    if (appStatus !== 'face_ok') return;
    setAppStatus('processing');
    setMessage('Đang xử lý...');

    try {
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = 480;
      canvas.height = Math.round(480 * video.videoHeight / video.videoWidth);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.75);

      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true })
      );
      const gps = `${pos.coords.latitude},${pos.coords.longitude}`;

      const deviceId = localStorage.getItem('employee_device_id');

      const targetUrl = correctionId ? '/api/attendance/correct' : '/api/attendance';
      const requestBody = correctionId
        ? {
            emp_id: empId,
            target_type: type,
            reason: 'Nhân viên tự sửa nhầm ca trực'
          }
        : {
            emp_id: empId,
            type,
            image: imageData,
            gps,
            is_suspicious: false,
            device_id: deviceId,
            gps_accuracy: pos.coords.accuracy
          };

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      setAppStatus('success');
      if (correctionId) {
        setSuccessMsg(`Đã sửa nhầm sang ${type === 'IN_TRUC' ? 'VÀO TRỰC' : 'VÀO LÀM'} thành công.`);
        setSelfCorrection(null); // Ẩn nút sửa nhầm sau khi sửa
      } else {
        const typeText = type === 'OUT' ? '🏠 Ra về' : `🏥 Vào ca ${type === 'IN_LAM' ? 'hành chính' : 'trực'}`;
        setSuccessMsg(`${typeText} thành công lúc ${new Date().toLocaleTimeString('vi-VN')}`);
      }
    } catch (err: unknown) {
      const geoErrorCode = getGeoErrorCode(err);
      if (geoErrorCode > 0) {
        const gpsError = getGpsErrorState(err);
        setAppStatus('gps_fail');
        setErrorAction(gpsError.action);
        setMessage(gpsError.message);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
      setAppStatus('error');
      setMessage(errorMessage);
    }
  };

  const handleSelfCorrection = async (targetType: 'IN_LAM' | 'IN_TRUC') => {
    if (!selfCorrection?.record_id) return;
    await handleAttendance(targetType, selfCorrection.record_id);
  };

  const handleGpsTrigger = async () => {
    setRequiresGpsTrigger(false);
    setAppStatus('loading');
    setMessage('Đang xác định vị trí...');
    await initSystem();
  };

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  if (!empId) {
    return (
      <main className="min-h-screen bg-bg-main flex items-center justify-center">
        <div className="glass p-10 rounded-2xl text-center space-y-4">
          <XCircle size={48} className="text-error mx-auto" />
          <p className="font-bold">Mã QR không hợp lệ</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-main p-4 pt-6 flex flex-col items-center">
      <div className="glass p-6 rounded-2xl max-w-xl w-full space-y-5 shadow-2xl animate-fade-in">

        {/* Tiêu đề */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold font-outfit">Điểm Danh</h1>
          <p className="text-text-muted text-sm font-medium">
            {employee?.ho_ten || empId} • {employee?.dm_khoa_phong?.ten_khoa || employee?.khoa_phong}
          </p>
        </div>

        {/* Trạng thái GPS */}
        <StatusBadge status={appStatus} />

        {/* Camera Feed — tách ra ngoài padding để chiếm full width của container */}
        {(appStatus === 'cam_loading' || appStatus === 'ready' || appStatus === 'face_ok' || appStatus === 'processing') && (
          <div className={`relative rounded-xl overflow-hidden aspect-[4/3] border-4 transition-colors mx-[-24px] ${appStatus === 'face_ok' ? 'border-success' : 'border-glass-border'
            }`}>
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />

            {/* Overlay khi processing */}
            {appStatus === 'processing' && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="text-white animate-spin" size={40} />
              </div>
            )}
          </div>
        )}

        {/* Message */}
        {appStatus !== 'success' && (
          <p className="text-center text-sm text-text-muted leading-relaxed min-h-[20px]">{message}</p>
        )}

        {/* Kích hoạt GPS thủ công cho iOS Safari */}
        {requiresGpsTrigger && (
          <button
            onClick={handleGpsTrigger}
            className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-xl transition-all active:scale-95 shadow-lg"
          >
            Nhấn để bật vị trí
          </button>
        )}

        {/* Nút bấm (chỉ hiện khi face_ok) */}
        {appStatus === 'face_ok' && showButtons.length > 0 && (
          <div className={`grid gap-3 ${showButtons.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {showButtons.map((btn) => (
              <button
                key={btn}
                onClick={() => handleAttendance(btn)}
                className={`${LABEL_MAP[btn].color} text-white font-bold py-4 rounded-xl transition-all active:scale-95 shadow-lg`}
              >
                {LABEL_MAP[btn].text}
              </button>
            ))}
          </div>
        )}

        {/* Nút sửa nhầm (tầng 1: nhân viên tự sửa trong cửa sổ thời gian) */}
        {appStatus === 'face_ok' && selfCorrection && selfCorrection.can_correct && (
          <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl space-y-2">
            <p className="text-xs text-amber-800 font-medium">
              Bạn có thể sửa nhầm trong {selfCorrection.expires_in_minutes} phút nữa (giữ nguyên giờ check-in ban đầu).
            </p>
            {selfCorrection.current_type === 'IN_LAM' ? (
              <button
                onClick={() => handleSelfCorrection('IN_TRUC')}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold py-2 rounded-lg"
              >
                Sửa nhầm thành VÀO TRỰC
              </button>
            ) : (
              <button
                onClick={() => handleSelfCorrection('IN_LAM')}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold py-2 rounded-lg"
              >
                Sửa nhầm thành VÀO LÀM
              </button>
            )}
          </div>
        )}

        {/* Màn hình thành công */}
        {appStatus === 'success' && (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 size={64} className="text-success mx-auto" />
            <p className="font-bold text-lg">THÀNH CÔNG!</p>
            <p className="text-text-muted text-sm">{successMsg}</p>
            {!successMsg.includes('Ra về') && (
              <button
                onClick={() => {
                  setAppStatus('face_ok');
                  setSuccessMsg('');
                }}
                className="text-primary text-sm underline"
              >
                Sửa chấm công
              </button>
            )}
          </div>
        )}

        {/* Màn hình lỗi */}
        {(appStatus === 'error' || appStatus === 'gps_fail') && (
          <div className="bg-error/10 border border-error/20 p-4 rounded-xl text-center space-y-3">
            <AlertTriangle className="text-error mx-auto" size={32} />
            <p className="text-sm text-error font-medium">{message}</p>
            <button
              onClick={() => {
                if (errorAction === 'reload') {
                  window.location.reload();
                  return;
                }
                setAppStatus('loading');
                setMessage('Đang thử lại...');
                initSystem();
              }}
              className="text-xs text-primary underline"
            >
              {errorAction === 'reload' ? 'Tải lại trang' : 'Thử lại'}
            </button>
          </div>
        )}
      </div>

      {/* Băng rôn cảnh báo động từ chối tăng cường */}
      {rejectedRecords.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-red-600 shadow-[0_-4px_20px_rgba(220,38,38,0.5)] text-white animate-in slide-in-from-bottom-full duration-500">
          <div className="max-w-md mx-auto space-y-3">
            {rejectedRecords.map(rec => {
              const match = rec.ghi_chu?.match(/\[TC_REJECTED:(.*?)\]/);
              const reason = match && match[1] ? match[1] : 'Không có lý do';
              if (!rec.thoi_gian) return null;
              const inTimeStr = new Date(rec.thoi_gian).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
              
              return (
                <div key={rec.id} className="flex items-start gap-3 bg-red-700/50 p-3 rounded-lg border border-red-500/50">
                  <AlertTriangle className="text-yellow-300 mt-0.5 shrink-0 animate-bounce" size={24} />
                  <div className="text-sm font-medium">
                    <p>Trưởng khoa đã <span className="font-bold text-yellow-300">TỪ CHỐI</span> ngày công tăng cường của bạn (từ {inTimeStr}).</p>
                    <p className="mt-1 opacity-90 italic">Lý do: {reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

// ------------------------------------------------------------------
// Sub-component: Badge trạng thái GPS / Camera / AI
// ------------------------------------------------------------------
function StatusBadge({ status }: { status: AppStatus }) {
  const config: Record<AppStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    loading: { icon: <Loader2 size={14} className="animate-spin" />, text: 'Đang khởi tạo...', cls: 'bg-slate-100 text-slate-500' },
    gps_fail: { icon: <MapPin size={14} />, text: 'Ngoài khuôn viên BV', cls: 'bg-error/10 text-error' },
    cam_loading: { icon: <Camera size={14} className="animate-pulse" />, text: 'Đang tải camera...', cls: 'bg-primary/10 text-primary' },
    ready: { icon: <Camera size={14} />, text: 'Camera hoạt động', cls: 'bg-primary/10 text-primary' },
    face_ok: { icon: <ShieldCheck size={14} />, text: 'Khuôn mặt xác nhận', cls: 'bg-success/10 text-success' },
    processing: { icon: <Loader2 size={14} className="animate-spin" />, text: 'Đang ghi nhận...', cls: 'bg-primary/10 text-primary' },
    success: { icon: <CheckCircle2 size={14} />, text: 'Đã chấm công', cls: 'bg-success/10 text-success' },
    error: { icon: <XCircle size={14} />, text: 'Lỗi hệ thống', cls: 'bg-error/10 text-error' },
  };
  const c = config[status];
  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs font-bold ${c.cls}`}>
      {c.icon} {c.text}
    </div>
  );
}

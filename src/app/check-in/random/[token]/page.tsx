'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Camera, MapPin, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';

interface RandomCheckSession {
  ho_ten: string;
  khoa_hien_tai: string | null;
}

export default function RandomCheckPage({ params }: { params: { token: string } }) {
  const [session, setSession] = useState<RandomCheckSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'info' | 'capture' | 'done'>('info');
  const [error, setError] = useState('');
  const { toastError, toastWarning } = useToast();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [gps, setGps] = useState<{lat: number, lon: number} | null>(null);

  useEffect(() => {
    fetch(`/api/random-check/submit?token=${params.token}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setSession(data);
        setLoading(false);
      });
  }, [params.token]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStep('capture');
      }
    } catch {
      toastError('Không thể mở camera. Vui lòng cấp quyền.');
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(dataUrl);
      
      // Stop camera
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      
      // Get GPS
      navigator.geolocation.getCurrentPosition(
        (pos) => setGps({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => toastError('Không thể lấy vị trí GPS. Vui lòng bật định vị.'),
        { enableHighAccuracy: true }
      );
    }
  };

  const handleSubmit = async () => {
    if (!capturedImage || !gps) return toastWarning('Vui lòng chụp ảnh và chờ lấy vị trí GPS');
    setSubmitting(true);
    try {
      const res = await fetch('/api/random-check/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: params.token,
          lat: gps.lat,
          lon: gps.lon,
          imageBase64: capturedImage
        })
      });
      if (res.ok) setStep('done');
      else {
        const d = await res.json();
        toastError(d.error || 'Lỗi gửi dữ liệu');
      }
    } catch { toastError('Lỗi kết nối'); }
    setSubmitting(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Đang tải...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-500 font-bold p-10 text-center"><AlertCircle className="mr-2" /> {error}</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        <header className="bg-slate-900 p-6 text-white text-center">
          <ShieldAlert className="mx-auto mb-2 text-red-400" size={32} />
          <h1 className="text-xl font-bold">KIỂM TRA ĐỘT XUẤT</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest">Yêu cầu từ Phòng TCCB</p>
        </header>

        <div className="p-6 space-y-6">
          {step === 'info' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-500 font-bold uppercase">Nhân viên thực hiện</p>
                <h2 className="text-lg font-bold text-slate-800">{session?.ho_ten || '---'}</h2>
                <p className="text-sm text-slate-600">Khoa: {session?.khoa_hien_tai || '---'}</p>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed text-center">
                Bạn được yêu cầu xác thực vị trí và khuôn mặt ngay lập tức để phục vụ công tác kiểm tra đột xuất của Bệnh viện.
              </p>
              <button 
                onClick={startCamera}
                className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2"
              >
                <Camera /> Bắt đầu xác thực
              </button>
            </div>
          )}

          {step === 'capture' && (
            <div className="space-y-6 animate-fade-in">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4] shadow-inner">
                {!capturedImage ? (
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                ) : (
                  <Image
                    src={capturedImage}
                    alt="Anh xac thuc ngau nhien"
                    fill
                    sizes="(max-width: 768px) 100vw, 448px"
                    className="object-cover"
                    unoptimized
                  />
                )}
                
                {gps && (
                  <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur p-2 rounded-lg text-[10px] flex items-center gap-2">
                    <MapPin size={12} className="text-red-500" />
                    <span className="font-mono">Tọa độ: {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</span>
                    <CheckCircle2 size={12} className="text-emerald-500 ml-auto" />
                  </div>
                )}
              </div>

              {!capturedImage ? (
                <button 
                  onClick={capturePhoto}
                  className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700 transition"
                >
                  Chụp ảnh xác nhận
                </button>
              ) : (
                <div className="flex gap-3">
                   <button 
                    onClick={() => { setCapturedImage(null); startCamera(); }}
                    className="flex-1 border border-slate-200 py-3 rounded-xl font-bold text-slate-600"
                  >
                    Chụp lại
                  </button>
                  <button 
                    disabled={submitting || !gps}
                    onClick={handleSubmit}
                    className="flex-2 bg-emerald-600 text-white py-3 px-6 rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {submitting ? 'Đang gửi...' : 'Gửi xác nhận'}
                  </button>
                </div>
              )}
              {!gps && capturedImage && <p className="text-[10px] text-amber-600 text-center animate-pulse italic">Đang chờ tín hiệu GPS...</p>}
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-10 space-y-4 animate-fade-in">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={40} />
              </div>
              <h2 className="text-2xl font-bold text-slate-800">Hoàn Tất!</h2>
              <p className="text-slate-500 px-6">Thông tin của bạn đã được gửi về hệ thống TCCB. Cảm ơn sự hợp tác của bạn.</p>
              <p className="text-[10px] text-slate-400 mt-10">Dữ liệu này sẽ tự động xóa sau khi phiên kiểm tra kết thúc.</p>
            </div>
          )}
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

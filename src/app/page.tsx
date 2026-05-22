import Link from 'next/link';
import { QrCode, ShieldCheck, MapPin, Zap, Users } from 'lucide-react';
import type { ReactNode } from 'react';

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-bg-main">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/10 blur-[120px] rounded-full" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-20 flex flex-col items-center text-center">
        <div className="animate-fade-in flex flex-col items-center">
          <div className="mb-8 flex items-center justify-center">
            <img src="/logo.png" width={120} height={120} alt="Logo" className="drop-shadow-xl" />
          </div>

          <h1 className="text-5xl md:text-7xl font-bold font-outfit tracking-tight mb-6">
            ChamCong <span className="gradient-text">Smart</span>
          </h1>

          <p className="text-xl text-text-muted max-w-2xl mb-12 leading-relaxed">
            Hệ thống chấm công thế hệ mới sử dụng Trí tuệ nhân tạo nhận diện khuôn mặt,
            kết hợp định vị GPS và lưu trữ đám mây bảo mật.
          </p>

          {/* Chỉ hiển thị 2 nút dành cho nhân viên. /manager và /admin truy cập qua URL trực tiếp. */}
          <div className="flex flex-wrap justify-center gap-6 mb-20">
            <Link href="/attendance" className="group flex flex-col items-center gap-2 px-10 py-6 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/30 hover:scale-105 transition-all">
              <QrCode size={32} />
              <span className="text-base">Chấm Công</span>
              <span className="text-[11px] font-normal opacity-80">Nhân viên quét mã</span>
            </Link>
            <Link href="/employee/login" className="group flex flex-col items-center gap-2 px-10 py-6 rounded-2xl glass border border-glass-border hover:bg-white/60 font-bold transition-all hover:scale-105">
              <Users size={32} className="text-slate-500" />
              <span className="text-base">Cổng Nhân Viên</span>
              <span className="text-[11px] font-normal text-text-muted">Tra cứu lịch sử</span>
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
          <FeatureCard
            icon={<ShieldCheck className="text-primary" />}
            title="Nhận diện Face-ID"
            description="Công nghệ Edge AI nhận diện khuôn mặt ngay tại trình duyệt, đảm bảo tính trung thực tuyệt đối."
          />
          <FeatureCard
            icon={<MapPin className="text-accent" />}
            title="Xác thực Vị trí"
            description="Chỉ cho phép chấm công trong phạm vi GPS quy định, ngăn chặn hoàn toàn việc điểm danh từ xa."
          />
          <FeatureCard
            icon={<Zap className="text-warning" />}
            title="Xử lý Tức thì"
            description="Dữ liệu được đồng bộ hóa với Supabase và Google Drive chỉ trong 0.5 giây."
          />
        </section>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-8 w-full text-center text-text-muted text-sm px-6">
        © 2026 Hệ thống Chấm công Bệnh viện Phụ sản - Nhi Đà Nẵng - Phát triển bởi Lê Văn Phú Thịnh
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="glass p-8 rounded-2xl text-left border border-white/40 hover:translate-y-[-5px] transition-all duration-300">
      <div className="mb-4 bg-white/50 w-fit p-3 rounded-xl shadow-inner">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-3 font-outfit">{title}</h3>
      <p className="text-text-muted leading-relaxed">
        {description}
      </p>
    </div>
  );
}

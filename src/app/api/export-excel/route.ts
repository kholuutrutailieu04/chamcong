import { NextRequest, NextResponse } from 'next/server';
import { generateAttendanceExcelReport } from '@/lib/excel-report';

export async function GET(req: NextRequest) {
  const khoa = req.nextUrl.searchParams.get('khoa') || 'ALL';
  const monthStr = req.nextUrl.searchParams.get('month');
  const requestEmail = req.headers.get('x-user-email') || '';

  if (requestEmail.toLowerCase().startsWith('test_')) {
    return NextResponse.json(
      { error: 'Chức năng xuất báo cáo không khả dụng cho tài khoản chạy thử (Sandbox Mode).' },
      { status: 403 },
    );
  }

  if (!monthStr) {
    return NextResponse.json({ error: 'Cần chỉ định tháng (YYYY-MM)' }, { status: 400 });
  }

  try {
    const report = await generateAttendanceExcelReport({ khoa, monthStr });
    return new NextResponse(report.buffer, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${report.filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error: unknown) {
    console.error('Export Error:', error);
    const message = error instanceof Error ? error.message : 'Lỗi sinh báo cáo';
    const status = message.includes('Không tìm thấy nhân sự') ? 404 : 500;
    return NextResponse.json({ error: message || 'Lỗi sinh báo cáo' }, { status });
  }
}

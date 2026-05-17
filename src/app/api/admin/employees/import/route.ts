import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import Papa from 'papaparse';
import { normalizeShiftType } from '@/lib/shift';
import { normalizeCampusCode } from '@/lib/campus';

type CsvRow = Record<string, string | null | undefined>;
type NhanVienInsert = Database['public']['Tables']['nhan_vien']['Insert'];

const HEADER_ALIASES: Record<string, string> = {
  ma_nv: 'ma_nv',
  ma_nhan_vien: 'ma_nv',
  ho_ten: 'ho_ten',
  ho_va_ten: 'ho_ten',
  khoa_phong: 'khoa_phong',
  loai_truc_mac_dinh: 'loai_truc_mac_dinh',
  ma_co_so_mac_dinh: 'ma_co_so_mac_dinh',
  phep_nam: 'quy_phep_nam',
  quy_phep_nam: 'quy_phep_nam',
  ngay_vao_lam: 'ngay_vao_lam',
  ngay_sinh: 'ngay_sinh',
  gioi_tinh: 'gioi_tinh',
  so_dien_thoai: 'so_dien_thoai',
  email: 'email',
  trang_thai: 'trang_thai',
};

export async function POST(req: NextRequest) {
  try {
    const { csvText } = await req.json();
    if (!csvText) {
      return NextResponse.json({ error: 'Không có dữ liệu CSV' }, { status: 400 });
    }

    // Phân tích cú pháp CSV
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => normalizeHeader(header)
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json({ error: 'Lỗi định dạng CSV', details: parsed.errors }, { status: 400 });
    }

    const rows = parsed.data as CsvRow[];
    
    // Chuẩn bị dữ liệu cho Supabase (chỉ lấy các cột cần thiết, các cột thiếu sẽ nhận default)
    const recordsToInsert: NhanVienInsert[] = [];
    for (const row of rows) {
      const ma_nv = row.ma_nv?.trim();
      const ho_ten = row.ho_ten?.trim();
      const khoa_phong = row.khoa_phong?.trim();
      if (!ma_nv || !ho_ten || !khoa_phong) continue;

      recordsToInsert.push({
        ma_nv,
        ho_ten,
        khoa_phong,
        loai_truc_mac_dinh: normalizeShiftType(row.loai_truc_mac_dinh?.trim() || 'HANH_CHINH'),
        ma_co_so_mac_dinh: (() => {
          const campus = normalizeCampusCode(row.ma_co_so_mac_dinh?.trim() || null);
          return campus === 'UNKNOWN' ? null : campus;
        })(),
        quy_phep_nam: parseOptionalNumber(row.quy_phep_nam),
        // Xử lý convert chuỗi ngày chuẩn DD/MM/YYYY hoặc YYYY-MM-DD sang ISO date
        ngay_vao_lam: parseDate(row.ngay_vao_lam),
        ngay_sinh: parseDate(row.ngay_sinh),
        gioi_tinh: row.gioi_tinh?.trim() || null,
        so_dien_thoai: row.so_dien_thoai?.trim() || null,
        email: row.email?.trim() || null,
        trang_thai: parseTrangThai(row.trang_thai),
      });
    }

    if (recordsToInsert.length === 0) {
      return NextResponse.json({ error: 'Không tìm thấy dữ liệu hợp lệ trong file' }, { status: 400 });
    }

    const admin = getAdminClient();

    // Thực hiện upsert với ignoreDuplicates = true (Bỏ qua nếu mã NV đã tồn tại)
    const { error } = await admin
      .from('nhan_vien')
      .upsert(recordsToInsert, { 
        onConflict: 'ma_nv', 
        ignoreDuplicates: true 
      });

    if (error) {
      console.error('Lỗi khi chèn CSV:', error);
      return NextResponse.json({ error: 'Lỗi máy chủ cơ sở dữ liệu' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Đã xử lý ${recordsToInsert.length} bản ghi hợp lệ.` 
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi xử lý dữ liệu CSV';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizeHeader(rawHeader: string) {
  const compact = rawHeader
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return HEADER_ALIASES[compact] || compact;
}

// Helper chuyển ngày về chuẩn YYYY-MM-DD
function parseDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const normalized = dateStr.toString().trim();
  if (!normalized) return null;

  // Cố gắng bắt "DD/MM/YYYY" hoặc "DD-MM-YYYY"
  const parts = normalized.split(/[/-]/);
  if (parts.length === 3) {
    // Nếu phần đầu là 4 số (YYYY-MM-DD)
    if (parts[0].length === 4) return `${parts[0]}-${parts[1]}-${parts[2]}`;
    // Nếu phần 3 là 4 số (DD/MM/YYYY)
    if (parts[2].length === 4) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return null; // Fallback
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseTrangThai(value: unknown) {
  if (value === null || value === undefined || value === '') return true;
  const normalized = value.toString().trim().toLowerCase();
  return !['false', '0', 'off', 'inactive', 'nghi'].includes(normalized);
}

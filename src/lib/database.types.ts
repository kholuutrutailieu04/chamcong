export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      bang_cong_ngay: {
        Row: {
          id: string
          ma_nv: string
          ngay: string
          thang: string
          ma_khoa: string | null
          work_minutes: number
          late_minutes: number
          early_leave_minutes: number
          overtime_minutes: number
          leave_paid_days: number
          leave_refunded_days: number
          unpaid_absence_minutes: number
          payroll_symbol: string | null
          source_status: string
          needs_review: boolean
          raw_record_ids: Json
          computed_at: string
        }
        Insert: {
          id?: string
          ma_nv: string
          ngay: string
          thang: string
          ma_khoa?: string | null
          work_minutes?: number
          late_minutes?: number
          early_leave_minutes?: number
          overtime_minutes?: number
          leave_paid_days?: number
          leave_refunded_days?: number
          unpaid_absence_minutes?: number
          payroll_symbol?: string | null
          source_status?: string
          needs_review?: boolean
          raw_record_ids?: Json
          computed_at?: string
        }
        Update: {
          id?: string
          ma_nv?: string
          ngay?: string
          thang?: string
          ma_khoa?: string | null
          work_minutes?: number
          late_minutes?: number
          early_leave_minutes?: number
          overtime_minutes?: number
          leave_paid_days?: number
          leave_refunded_days?: number
          unpaid_absence_minutes?: number
          payroll_symbol?: string | null
          source_status?: string
          needs_review?: boolean
          raw_record_ids?: Json
          computed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bang_cong_ngay_ma_khoa_fkey"
            columns: ["ma_khoa"]
            isOneToOne: false
            referencedRelation: "dm_khoa_phong"
            referencedColumns: ["ma_khoa"]
          },
          {
            foreignKeyName: "bang_cong_ngay_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      bang_cong_ngay_archive: {
        Row: {
          id: string
          ma_nv: string
          ngay: string
          thang: string
          ma_khoa: string | null
          work_minutes: number
          late_minutes: number
          early_leave_minutes: number
          overtime_minutes: number
          leave_paid_days: number
          leave_refunded_days: number
          unpaid_absence_minutes: number
          payroll_symbol: string | null
          source_status: string
          needs_review: boolean
          raw_record_ids: Json
          computed_at: string
        }
        Insert: {
          id?: string
          ma_nv: string
          ngay: string
          thang: string
          ma_khoa?: string | null
          work_minutes?: number
          late_minutes?: number
          early_leave_minutes?: number
          overtime_minutes?: number
          leave_paid_days?: number
          leave_refunded_days?: number
          unpaid_absence_minutes?: number
          payroll_symbol?: string | null
          source_status?: string
          needs_review?: boolean
          raw_record_ids?: Json
          computed_at?: string
        }
        Update: {
          id?: string
          ma_nv?: string
          ngay?: string
          thang?: string
          ma_khoa?: string | null
          work_minutes?: number
          late_minutes?: number
          early_leave_minutes?: number
          overtime_minutes?: number
          leave_paid_days?: number
          leave_refunded_days?: number
          unpaid_absence_minutes?: number
          payroll_symbol?: string | null
          source_status?: string
          needs_review?: boolean
          raw_record_ids?: Json
          computed_at?: string
        }
        Relationships: []
      }
      bang_truc_noi_bo: {
        Row: {
          id: string
          ma_nv: string
          ho_ten: string | null
          ma_khoa: string
          thang: string
          loai_ca: string
          ghi_chu: string | null
          nguoi_phan_cong: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          ma_nv: string
          ho_ten?: string | null
          ma_khoa: string
          thang: string
          loai_ca: string
          ghi_chu?: string | null
          nguoi_phan_cong?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          ma_nv?: string
          ho_ten?: string | null
          ma_khoa?: string
          thang?: string
          loai_ca?: string
          ghi_chu?: string | null
          nguoi_phan_cong?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cau_hinh_ca_truc: {
        Row: {
          id: string
          ma_ca: string
          ma_ca_cha: string | null
          ten_ca: string
          gio_bat_dau: string
          gio_ket_thuc: string
          vat_qua_nua_dem: boolean | null
          thoi_gian_nghi_toi_thieu_h: number | null
          co_nghi_bu: boolean | null
          ky_hieu_bang_cong: string
          ghi_chu: string | null
          created_at: string | null
          /** Mốc giờ cho phép check-out sớm (Grace Period) của ca trực qua đêm.
           *  NULL = không áp dụng (ca Hành chính, ca ban ngày).
           *  Ví dụ: '07:30:00' = được về từ 7h30 sáng hôm sau. */
          gio_cho_phep_ve_som: string | null
        }
        Insert: {
          id?: string
          ma_ca: string
          ma_ca_cha?: string | null
          ten_ca: string
          gio_bat_dau: string
          gio_ket_thuc: string
          vat_qua_nua_dem?: boolean | null
          thoi_gian_nghi_toi_thieu_h?: number | null
          co_nghi_bu?: boolean | null
          ky_hieu_bang_cong: string
          ghi_chu?: string | null
          created_at?: string | null
          gio_cho_phep_ve_som?: string | null
        }
        Update: {
          id?: string
          ma_ca?: string
          ma_ca_cha?: string | null
          ten_ca?: string
          gio_bat_dau?: string
          gio_ket_thuc?: string
          vat_qua_nua_dem?: boolean | null
          thoi_gian_nghi_toi_thieu_h?: number | null
          co_nghi_bu?: boolean | null
          ky_hieu_bang_cong?: string
          ghi_chu?: string | null
          created_at?: string | null
          gio_cho_phep_ve_som?: string | null
        }
        Relationships: []
      }
      cau_hinh_he_thong: {
        Row: {
          key: string
          value: string
          mo_ta: string | null
          kieu_du_lieu: string | null
          trang_thai: boolean | null
        }
        Insert: {
          key: string
          value: string
          mo_ta?: string | null
          kieu_du_lieu?: string | null
          trang_thai?: boolean | null
        }
        Update: {
          key?: string
          value?: string
          mo_ta?: string | null
          kieu_du_lieu?: string | null
          trang_thai?: boolean | null
        }
        Relationships: []
      }
      co_so: {
        Row: {
          id: string
          ma_co_so: string
          ten_co_so: string
          latitude: number
          longitude: number
          ban_kinh_met: number
          dia_chi: string | null
          trang_thai: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          ma_co_so: string
          ten_co_so: string
          latitude: number
          longitude: number
          ban_kinh_met: number
          dia_chi?: string | null
          trang_thai?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          ma_co_so?: string
          ten_co_so?: string
          latitude?: number
          longitude?: number
          ban_kinh_met?: number
          dia_chi?: string | null
          trang_thai?: boolean | null
          created_at?: string | null
        }
        Relationships: []
      }
      dm_khoa_phong: {
        Row: {
          ma_khoa: string
          ten_khoa: string
          email_truong_khoa: string | null
          trang_thai: boolean | null
          cho_phep_chia_ca_truc: boolean | null
          cho_phep_hanh_chinh: boolean | null
          cho_phep_12_24: boolean | null
          cho_phep_16_24: boolean | null
          cho_phep_24_24: boolean | null
          cho_phep_3ca4kip: boolean | null
        }
        Insert: {
          ma_khoa: string
          ten_khoa: string
          email_truong_khoa?: string | null
          trang_thai?: boolean | null
          cho_phep_chia_ca_truc?: boolean | null
          cho_phep_hanh_chinh?: boolean | null
          cho_phep_12_24?: boolean | null
          cho_phep_16_24?: boolean | null
          cho_phep_24_24?: boolean | null
          cho_phep_3ca4kip?: boolean | null
        }
        Update: {
          ma_khoa?: string
          ten_khoa?: string
          email_truong_khoa?: string | null
          trang_thai?: boolean | null
          cho_phep_chia_ca_truc?: boolean | null
          cho_phep_hanh_chinh?: boolean | null
          cho_phep_12_24?: boolean | null
          cho_phep_16_24?: boolean | null
          cho_phep_24_24?: boolean | null
          cho_phep_3ca4kip?: boolean | null
        }
        Relationships: []
      }
      dm_khoa_phong_emails: {
        Row: {
          email: string
          ma_khoa: string | null
          ho_ten: string
          trang_thai: boolean | null
          created_at: string | null
          mat_khau: string | null
          role: string
          password_changed_at: string | null
          last_login_at: string | null
          failed_login_count: number
          locked_until: string | null
          session_version: number
        }
        Insert: {
          email: string
          ma_khoa?: string | null
          ho_ten: string
          trang_thai?: boolean | null
          created_at?: string | null
          mat_khau?: string | null
          role?: string
          password_changed_at?: string | null
          last_login_at?: string | null
          failed_login_count?: number
          locked_until?: string | null
          session_version?: number
        }
        Update: {
          email?: string
          ma_khoa?: string | null
          ho_ten?: string
          trang_thai?: boolean | null
          created_at?: string | null
          mat_khau?: string | null
          role?: string
          password_changed_at?: string | null
          last_login_at?: string | null
          failed_login_count?: number
          locked_until?: string | null
          session_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dm_khoa_phong_emails_ma_khoa_fkey"
            columns: ["ma_khoa"]
            isOneToOne: false
            referencedRelation: "dm_khoa_phong"
            referencedColumns: ["ma_khoa"]
          },
        ]
      }
      don_nghi_phep: {
        Row: {
          id: string
          ma_nv: string
          ho_ten: string | null
          loai_nghi: string
          tu_ngay: string
          den_ngay: string
          ly_do: string | null
          da_xu_ly_bot: boolean | null
          created_at: string | null
          is_test: boolean | null
          audit_log: Json | null
          /** Phân loại buổi nghỉ: 'CA_NGAY' | 'SANG' | 'CHIEU'. Mặc định 'CA_NGAY'. */
          buoi_nghi: string
        }
        Insert: {
          id?: string
          ma_nv: string
          ho_ten?: string | null
          loai_nghi: string
          tu_ngay: string
          den_ngay: string
          ly_do?: string | null
          da_xu_ly_bot?: boolean | null
          created_at?: string | null
          is_test?: boolean | null
          audit_log?: Json | null
          buoi_nghi?: string
        }
        Update: {
          id?: string
          ma_nv?: string
          ho_ten?: string | null
          loai_nghi?: string
          tu_ngay?: string
          den_ngay?: string
          ly_do?: string | null
          da_xu_ly_bot?: boolean | null
          created_at?: string | null
          is_test?: boolean | null
          audit_log?: Json | null
          buoi_nghi?: string
        }
        Relationships: [
          {
            foreignKeyName: "don_nghi_phep_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      kiem_tra_dot_xuat: {
        Row: {
          id: string
          token: string
          ma_nv: string
          ho_ten: string | null
          khoa_hien_tai: string | null
          co_so_hien_tai: string | null
          trang_thai_du_kien: string | null
          lat_thuc_te: number | null
          lon_thuc_te: number | null
          is_match_gps: boolean | null
          link_anh_mat: string | null
          thoi_gian_gui: string | null
          thoi_gian_phan_hoi: string | null
          trang_thai: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          token: string
          ma_nv: string
          ho_ten?: string | null
          khoa_hien_tai?: string | null
          co_so_hien_tai?: string | null
          trang_thai_du_kien?: string | null
          lat_thuc_te?: number | null
          lon_thuc_te?: number | null
          is_match_gps?: boolean | null
          link_anh_mat?: string | null
          thoi_gian_gui?: string | null
          thoi_gian_phan_hoi?: string | null
          trang_thai?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          token?: string
          ma_nv?: string
          ho_ten?: string | null
          khoa_hien_tai?: string | null
          co_so_hien_tai?: string | null
          trang_thai_du_kien?: string | null
          lat_thuc_te?: number | null
          lon_thuc_te?: number | null
          is_match_gps?: boolean | null
          link_anh_mat?: string | null
          thoi_gian_gui?: string | null
          thoi_gian_phan_hoi?: string | null
          trang_thai?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      image_sync_jobs: {
        Row: {
          id: string
          source_record_id: string
          supabase_bucket: string
          supabase_path: string
          supabase_public_url: string
          drive_file_name: string
          drive_folder_hint: string | null
          sync_status: string
          attempt_count: number
          max_attempts: number
          next_retry_at: string
          last_error: string | null
          drive_link: string | null
          synced_at: string | null
          delete_after: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_record_id: string
          supabase_bucket: string
          supabase_path: string
          supabase_public_url: string
          drive_file_name: string
          drive_folder_hint?: string | null
          sync_status?: string
          attempt_count?: number
          max_attempts?: number
          next_retry_at?: string
          last_error?: string | null
          drive_link?: string | null
          synced_at?: string | null
          delete_after?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_record_id?: string
          supabase_bucket?: string
          supabase_path?: string
          supabase_public_url?: string
          drive_file_name?: string
          drive_folder_hint?: string | null
          sync_status?: string
          attempt_count?: number
          max_attempts?: number
          next_retry_at?: string
          last_error?: string | null
          drive_link?: string | null
          synced_at?: string | null
          delete_after?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_sync_jobs_source_record_fkey"
            columns: ["source_record_id"]
            isOneToOne: true
            referencedRelation: "lich_su_cham_cong"
            referencedColumns: ["id"]
          },
        ]
      }
      lich_luan_chuyen: {
        Row: {
          id: string
          ma_nv: string | null
          khoa_den: string
          loai_truc_moi: string | null
          ma_co_so_dich: string | null
          tu_ngay: string
          den_ngay: string | null
          so_quyet_dinh: string | null
          created_at: string | null
          is_test: boolean | null
        }
        Insert: {
          id?: string
          ma_nv?: string | null
          khoa_den: string
          loai_truc_moi?: string | null
          ma_co_so_dich?: string | null
          tu_ngay: string
          den_ngay?: string | null
          so_quyet_dinh?: string | null
          created_at?: string | null
          is_test?: boolean | null
        }
        Update: {
          id?: string
          ma_nv?: string | null
          khoa_den?: string
          loai_truc_moi?: string | null
          ma_co_so_dich?: string | null
          tu_ngay?: string
          den_ngay?: string | null
          so_quyet_dinh?: string | null
          created_at?: string | null
          is_test?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "lich_luan_chuyen_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      lich_nghi_bu: {
        Row: {
          id: string
          ma_nv: string
          ngay_nghi: string
          created_at: string | null
          khoa_phong: string | null
        }
        Insert: {
          id?: string
          ma_nv: string
          ngay_nghi: string
          created_at?: string | null
          khoa_phong?: string | null
        }
        Update: {
          id?: string
          ma_nv?: string
          ngay_nghi?: string
          created_at?: string | null
          khoa_phong?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lich_nghi_bu_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      first_day_ra_truc_markers: {
        Row: {
          id: string
          ma_nv: string
          ho_ten: string | null
          ma_khoa: string
          ngay_ap_dung: string
          attendance_record_id: string | null
          ghi_chu: string | null
          created_by: string
          created_at: string
          is_test: boolean
        }
        Insert: {
          id?: string
          ma_nv: string
          ho_ten?: string | null
          ma_khoa: string
          ngay_ap_dung: string
          attendance_record_id?: string | null
          ghi_chu?: string | null
          created_by: string
          created_at?: string
          is_test?: boolean
        }
        Update: {
          id?: string
          ma_nv?: string
          ho_ten?: string | null
          ma_khoa?: string
          ngay_ap_dung?: string
          attendance_record_id?: string | null
          ghi_chu?: string | null
          created_by?: string
          created_at?: string
          is_test?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "first_day_ra_truc_markers_attendance_record_id_fkey"
            columns: ["attendance_record_id"]
            isOneToOne: false
            referencedRelation: "lich_su_cham_cong"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "first_day_ra_truc_markers_ma_khoa_fkey"
            columns: ["ma_khoa"]
            isOneToOne: false
            referencedRelation: "dm_khoa_phong"
            referencedColumns: ["ma_khoa"]
          },
          {
            foreignKeyName: "first_day_ra_truc_markers_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: true
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      lich_su_cham_cong: {
        Row: {
          id: string
          thoi_gian: string | null
          ma_nv: string | null
          ho_ten: string | null
          khoa_ghi_nhan: string | null
          loai_ca: string | null
          link_anh_minh_chung: string | null
          ghi_chu: string | null
          ma_co_so: string | null
          is_suspicious: boolean | null
          in_record_id: string | null
          is_test: boolean | null
          ho_tro_boi: string | null
        }
        Insert: {
          id?: string
          thoi_gian?: string | null
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca?: string | null
          link_anh_minh_chung?: string | null
          ghi_chu?: string | null
          ma_co_so?: string | null
          is_suspicious?: boolean | null
          in_record_id?: string | null
          is_test?: boolean | null
          ho_tro_boi?: string | null
        }
        Update: {
          id?: string
          thoi_gian?: string | null
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca?: string | null
          link_anh_minh_chung?: string | null
          ghi_chu?: string | null
          ma_co_so?: string | null
          is_suspicious?: boolean | null
          in_record_id?: string | null
          is_test?: boolean | null
          ho_tro_boi?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lich_su_cham_cong_in_record_id_fkey"
            columns: ["in_record_id"]
            isOneToOne: false
            referencedRelation: "lich_su_cham_cong"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lich_su_cham_cong_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      lich_su_cham_cong_archive: {
        Row: {
          id: string
          thoi_gian: string | null
          ma_nv: string | null
          ho_ten: string | null
          khoa_ghi_nhan: string | null
          loai_ca: string | null
          link_anh_minh_chung: string | null
          ghi_chu: string | null
          ma_co_so: string | null
          is_suspicious: boolean | null
          in_record_id: string | null
          is_test: boolean | null
          ho_tro_boi: string | null
        }
        Insert: {
          id?: string
          thoi_gian?: string | null
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca?: string | null
          link_anh_minh_chung?: string | null
          ghi_chu?: string | null
          ma_co_so?: string | null
          is_suspicious?: boolean | null
          in_record_id?: string | null
          is_test?: boolean | null
          ho_tro_boi?: string | null
        }
        Update: {
          id?: string
          thoi_gian?: string | null
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca?: string | null
          link_anh_minh_chung?: string | null
          ghi_chu?: string | null
          ma_co_so?: string | null
          is_suspicious?: boolean | null
          in_record_id?: string | null
          is_test?: boolean | null
          ho_tro_boi?: string | null
        }
        Relationships: []
      }
      lich_su_sua_nham_cham_cong: {
        Row: {
          id: string
          record_id: string
          ma_nv: string | null
          ho_ten: string | null
          khoa_ghi_nhan: string | null
          loai_ca_cu: string
          loai_ca_moi: string
          thoi_gian_goc: string | null
          pham_vi_sua: string
          ly_do: string | null
          nguoi_sua: string | null
          is_test: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          record_id: string
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca_cu: string
          loai_ca_moi: string
          thoi_gian_goc?: string | null
          pham_vi_sua: string
          ly_do?: string | null
          nguoi_sua?: string | null
          is_test?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          record_id?: string
          ma_nv?: string | null
          ho_ten?: string | null
          khoa_ghi_nhan?: string | null
          loai_ca_cu?: string
          loai_ca_moi?: string
          thoi_gian_goc?: string | null
          pham_vi_sua?: string
          ly_do?: string | null
          nguoi_sua?: string | null
          is_test?: boolean | null
          created_at?: string | null
        }
        Relationships: []
      }
      log_gian_lan: {
        Row: {
          id: string
          thoi_gian: string | null
          ma_nv_bi_ho: string | null
          ho_ten_bi_ho: string | null
          khoa_bi_ho: string | null
          link_anh_ke_gian: string | null
          ma_nv_ke_gian: string | null
          khoa_ke_gian: string | null
          is_test: boolean | null
          loai_gian_lan: string | null
          id_thiet_bi: string | null
          ghi_chu: string | null
        }
        Insert: {
          id?: string
          thoi_gian?: string | null
          ma_nv_bi_ho?: string | null
          ho_ten_bi_ho?: string | null
          khoa_bi_ho?: string | null
          link_anh_ke_gian?: string | null
          ma_nv_ke_gian?: string | null
          khoa_ke_gian?: string | null
          is_test?: boolean | null
          loai_gian_lan?: string | null
          id_thiet_bi?: string | null
          ghi_chu?: string | null
        }
        Update: {
          id?: string
          thoi_gian?: string | null
          ma_nv_bi_ho?: string | null
          ho_ten_bi_ho?: string | null
          khoa_bi_ho?: string | null
          link_anh_ke_gian?: string | null
          ma_nv_ke_gian?: string | null
          khoa_ke_gian?: string | null
          is_test?: boolean | null
          loai_gian_lan?: string | null
          id_thiet_bi?: string | null
          ghi_chu?: string | null
        }
        Relationships: []
      }
      ngay_le: {
        Row: {
          id: string
          ngay: string
          ten_ngay_le: string
          nam: number
          loai: string | null
        }
        Insert: {
          id?: string
          ngay: string
          ten_ngay_le: string
          nam: number
          loai?: string | null
        }
        Update: {
          id?: string
          ngay?: string
          ten_ngay_le?: string
          nam?: number
          loai?: string | null
        }
        Relationships: []
      }
      phep_quota_transactions: {
        Row: {
          id: string
          leave_id: string
          ma_nv: string
          ngay: string
          buoi_nghi: string
          amount_days: number
          transaction_type: string
          reason: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          leave_id: string
          ma_nv: string
          ngay: string
          buoi_nghi: string
          amount_days: number
          transaction_type: string
          reason?: string | null
          source: string
          created_at?: string
        }
        Update: {
          id?: string
          leave_id?: string
          ma_nv?: string
          ngay?: string
          buoi_nghi?: string
          amount_days?: number
          transaction_type?: string
          reason?: string | null
          source?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phep_quota_transactions_leave_id_fkey"
            columns: ["leave_id"]
            isOneToOne: false
            referencedRelation: "don_nghi_phep"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phep_quota_transactions_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      nhan_vien: {
        Row: {
          id: string
          ma_nv: string
          ho_ten: string
          khoa_phong: string
          ma_co_so_mac_dinh: string | null
          loai_truc_mac_dinh: string | null
          quy_phep_nam: number | null
          ngay_vao_lam: string | null
          ngay_sinh: string | null
          gioi_tinh: string | null
          so_dien_thoai: string | null
          email: string | null
          trang_thai: boolean | null
          cho_phep_di_chuyen_tu_do: boolean | null
        }
        Insert: {
          id?: string
          ma_nv: string
          ho_ten: string
          khoa_phong: string
          ma_co_so_mac_dinh?: string | null
          loai_truc_mac_dinh?: string | null
          quy_phep_nam?: number | null
          ngay_vao_lam?: string | null
          ngay_sinh?: string | null
          gioi_tinh?: string | null
          so_dien_thoai?: string | null
          email?: string | null
          trang_thai?: boolean | null
          cho_phep_di_chuyen_tu_do?: boolean | null
        }
        Update: {
          id?: string
          ma_nv?: string
          ho_ten?: string
          khoa_phong?: string
          ma_co_so_mac_dinh?: string | null
          loai_truc_mac_dinh?: string | null
          quy_phep_nam?: number | null
          ngay_vao_lam?: string | null
          ngay_sinh?: string | null
          gioi_tinh?: string | null
          so_dien_thoai?: string | null
          email?: string | null
          trang_thai?: boolean | null
          cho_phep_di_chuyen_tu_do?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "nhan_vien_khoa_phong_fkey"
            columns: ["khoa_phong"]
            isOneToOne: false
            referencedRelation: "dm_khoa_phong"
            referencedColumns: ["ma_khoa"]
          },
          {
            foreignKeyName: "fk_nhanvien_cautruc"
            columns: ["loai_truc_mac_dinh"]
            isOneToOne: false
            referencedRelation: "cau_hinh_ca_truc"
            referencedColumns: ["ma_ca"]
          },
          {
            foreignKeyName: "nhan_vien_ma_co_so_mac_dinh_fkey"
            columns: ["ma_co_so_mac_dinh"]
            isOneToOne: false
            referencedRelation: "co_so"
            referencedColumns: ["ma_co_so"]
          },
        ]
      }
      thiet_bi_nhan_vien: {
        Row: {
          id: string
          ma_nv: string
          device_id: string
          ten_thiet_bi: string | null
          ip_gan_nhat: string | null
          ngay_dang_ky: string | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          ma_nv: string
          device_id: string
          ten_thiet_bi?: string | null
          ip_gan_nhat?: string | null
          ngay_dang_ky?: string | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          ma_nv?: string
          device_id?: string
          ten_thiet_bi?: string | null
          ip_gan_nhat?: string | null
          ngay_dang_ky?: string | null
          is_active?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "thiet_bi_nhan_vien_ma_nv_fkey"
            columns: ["ma_nv"]
            isOneToOne: false
            referencedRelation: "nhan_vien"
            referencedColumns: ["ma_nv"]
          },
        ]
      }
      yeu_cau_quan_tri: {
        Row: {
          id: string
          loai_yeu_cau: string
          ma_nv: string
          ho_ten: string | null
          ma_khoa_nguon: string | null
          ma_khoa_dich: string | null
          ma_co_so_nguon: string | null
          ma_co_so_dich: string | null
          tu_ngay: string
          den_ngay: string | null
          noi_dung_nguon: string | null
          noi_dung_dich: string | null
          trang_thai: string | null
          nguoi_duyet: string | null
          ngay_duyet: string | null
          created_at: string | null
          is_test: boolean | null
        }
        Insert: {
          id?: string
          loai_yeu_cau: string
          ma_nv: string
          ho_ten?: string | null
          ma_khoa_nguon?: string | null
          ma_khoa_dich?: string | null
          ma_co_so_nguon?: string | null
          ma_co_so_dich?: string | null
          tu_ngay: string
          den_ngay?: string | null
          noi_dung_nguon?: string | null
          noi_dung_dich?: string | null
          trang_thai?: string | null
          nguoi_duyet?: string | null
          ngay_duyet?: string | null
          created_at?: string | null
          is_test?: boolean | null
        }
        Update: {
          id?: string
          loai_yeu_cau?: string
          ma_nv?: string
          ho_ten?: string | null
          ma_khoa_nguon?: string | null
          ma_khoa_dich?: string | null
          ma_co_so_nguon?: string | null
          ma_co_so_dich?: string | null
          tu_ngay?: string
          den_ngay?: string | null
          noi_dung_nguon?: string | null
          noi_dung_dich?: string | null
          trang_thai?: string | null
          nguoi_duyet?: string | null
          ngay_duyet?: string | null
          created_at?: string | null
          is_test?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      process_rotation_timeline: {
        Args: {
          p_ma_nv: string
          p_khoa_dich: string
          p_tu_ngay: string
          p_den_ngay?: string | null
          p_co_so_dich?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

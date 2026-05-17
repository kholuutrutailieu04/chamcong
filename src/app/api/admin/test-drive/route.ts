/**
 * GET /api/admin/test-drive
 *
 * Endpoint debug để kiểm tra Service Account key có kết nối đúng
 * vào GOOGLE_DRIVE_FOLDER_ID hay không.
 *
 * Chỉ dùng nội bộ — bảo vệ bằng CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listFilesInConfiguredFolder, uploadToDriveWithFolderHierarchy, deleteFileFromDrive } from '@/lib/drive';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const results: Record<string, unknown> = {
    env_check: {
      GOOGLE_DRIVE_FOLDER_ID: folderId ? `✅ ${folderId}` : '❌ Chưa cấu hình',
      GOOGLE_DRIVE_CLIENT_EMAIL: clientEmail ? `✅ ${clientEmail}` : '❌ Chưa cấu hình',
      GOOGLE_DRIVE_PRIVATE_KEY: process.env.GOOGLE_DRIVE_PRIVATE_KEY ? '✅ Có' : '❌ Chưa cấu hình',
      GAS_UPLOAD_WEBAPP_URL: process.env.GAS_UPLOAD_WEBAPP_URL ? '✅ Có' : '⚠️ Không cấu hình',
    },
  };

  // Bước 1: Liệt kê file trong folder
  try {
    const files = await listFilesInConfiguredFolder();
    results.list_files = {
      status: '✅ Kết nối OK',
      folder_id: folderId,
      count: files.length,
      files: files.map((f) => ({ name: f.name, id: f.id, parents: f.parents })),
    };
  } catch (e: unknown) {
    results.list_files = {
      status: '❌ Thất bại',
      error: e instanceof Error ? e.message : String(e),
    };
    return NextResponse.json(results, { status: 500 });
  }

  // Bước 2: Upload file test nhỏ
  let uploadedFileId: string | null = null;
  try {
    const testBuffer = Buffer.from(`ChamCong Drive Test — ${new Date().toISOString()}`);
    const testFileName = `test_${Date.now()}.txt`;
    const link = await uploadToDriveWithFolderHierarchy(testBuffer, testFileName, 'text/plain', 'TEST_FOLDER');

    // Trích xuất ID từ link
    const match = link.match(/\/d\/([a-zA-Z0-9-_]+)\//);
    uploadedFileId = match ? match[1] : null;

    results.upload_test = {
      status: '✅ Upload thành công',
      file_name: testFileName,
      link,
      file_id: uploadedFileId,
    };
  } catch (e: unknown) {
    results.upload_test = {
      status: '❌ Upload thất bại',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Bước 3: Xóa file test vừa upload
  if (uploadedFileId) {
    try {
      await deleteFileFromDrive(uploadedFileId);
      results.cleanup_test = { status: '✅ Xóa file test thành công' };
    } catch (e: unknown) {
      results.cleanup_test = {
        status: '⚠️ Xóa thất bại (file vẫn còn trên Drive)',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const allOk = !String(JSON.stringify(results)).includes('❌');
  return NextResponse.json({
    summary: allOk ? '✅ Drive kết nối và upload hoạt động bình thường' : '❌ Có lỗi, xem chi tiết bên dưới',
    ...results,
  }, { status: allOk ? 200 : 500 });
}

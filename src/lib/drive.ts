/**
 * drive.ts — Google Drive OAuth2 (User-delegated) helper
 *
 * Xác thực bằng OAuth2 thay mặt tài khoản cá nhân của Owner.
 * File upload sẽ thuộc sở hữu của Owner → dùng quota cá nhân (15GB+).
 *
 * Biến môi trường cần thiết:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   GOOGLE_DRIVE_FOLDER_ID (folder đích trên Drive)
 */
import { google } from 'googleapis';
import { Readable } from 'stream';

let driveClientCache: ReturnType<typeof google.drive> | null = null;

async function getDriveClient() {
  if (driveClientCache) return driveClientCache;

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[Drive] Thiếu credentials OAuth2: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, hoặc GOOGLE_REFRESH_TOKEN');
  }

  console.log('[Drive] Khởi tạo OAuth2 client (user-delegated)');

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  driveClientCache = google.drive({ version: 'v3', auth });
  return driveClientCache;
}

/**
 * Tìm hoặc tạo một thư mục con trong một folder cha cụ thể.
 * Idempotent: nếu folder đã tồn tại thì trả về ID của nó.
 */
async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  folderName: string,
  parentId: string,
): Promise<string> {
  const safeName = folderName.replace(/'/g, "\\'");

  const searchResult = await drive.files.list({
    q: `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (searchResult.data.files && searchResult.data.files.length > 0) {
    const folderId = searchResult.data.files[0].id!;
    console.log(`[Drive] Folder "${folderName}" đã tồn tại: ${folderId}`);
    return folderId;
  }

  const createResult = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const newId = createResult.data.id!;
  console.log(`[Drive] Đã tạo folder "${folderName}" → ${newId} (parent: ${parentId})`);
  return newId;
}

/**
 * Đảm bảo toàn bộ cây thư mục tồn tại, trả về ID folder cuối cùng.
 * Ví dụ: pathParts = ['Thang_4_2026', 'CS1', 'Khoa_San']
 */
async function ensureFolderPath(
  drive: ReturnType<typeof google.drive>,
  pathParts: string[],
  rootFolderId: string,
): Promise<string> {
  let currentParentId = rootFolderId;
  for (const part of pathParts) {
    const safeName = part.replace(/[/\\:*?"<>|]/g, '_').trim();
    if (!safeName) continue;
    currentParentId = await findOrCreateFolder(drive, safeName, currentParentId);
  }
  return currentParentId;
}

/**
 * Upload buffer lên Google Drive vào đúng cấu trúc thư mục phân cấp.
 * pathHint: "Thang_4_2026/CS1/Khoa_San"
 *
 * QUAN TRỌNG: file luôn được đặt vào GOOGLE_DRIVE_FOLDER_ID (không phải My Drive).
 */
export async function uploadToDriveWithFolderHierarchy(
  buffer: Buffer,
  fileName: string,
  mimeType = 'image/jpeg',
  pathHint?: string,
): Promise<string> {
  const drive = await getDriveClient();
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!rootFolderId) {
    throw new Error('[Drive] GOOGLE_DRIVE_FOLDER_ID chưa được cấu hình trong .env');
  }

  console.log(`[Drive] Upload target folder ID: ${rootFolderId}`);
  console.log(`[Drive] File: ${fileName}, path hint: ${pathHint ?? '(root)'}`);

  let targetFolderId = rootFolderId;
  if (pathHint) {
    const pathParts = pathHint.split('/').filter(Boolean);
    targetFolderId = await ensureFolderPath(drive, pathParts, rootFolderId);
  }

  console.log(`[Drive] Đang upload "${fileName}" vào folder ${targetFolderId}...`);

  const bufferStream = new Readable();
  bufferStream.push(buffer);
  bufferStream.push(null);

  let file;
  try {
    file = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [targetFolderId],
      },
      media: {
        mimeType,
        body: bufferStream,
      },
      fields: 'id, webViewLink, name, parents',
      supportsAllDrives: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Drive] ❌ Upload thất bại: ${msg}`);
    console.error(`[Drive] Chi tiết: rootFolderId=${rootFolderId}, targetFolderId=${targetFolderId}, fileName=${fileName}`);
    throw new Error(`[Drive] Upload thất bại: ${msg}`);
  }

  const fileId = file.data.id;
  const webViewLink = file.data.webViewLink;
  const actualParents = file.data.parents;

  console.log(`[Drive] ✅ Upload thành công: ${fileName}`);
  console.log(`[Drive]   File ID: ${fileId}`);
  console.log(`[Drive]   Link: ${webViewLink}`);
  console.log(`[Drive]   Folder (parents): ${JSON.stringify(actualParents)}`);

  // Xác nhận file nằm đúng folder mong muốn
  if (actualParents && !actualParents.includes(targetFolderId)) {
    console.warn(`[Drive] ⚠️ File được đặt vào ${JSON.stringify(actualParents)} thay vì ${targetFolderId}`);
  }

  // Cấp quyền đọc cho TCCB (nếu có cấu hình)
  const tccbEmail = process.env.GOOGLE_DRIVE_TCCB_EMAIL;
  if (tccbEmail && fileId) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'user',
          emailAddress: tccbEmail,
        },
        supportsAllDrives: true,
      });
      console.log(`[Drive] Đã cấp quyền đọc cho ${tccbEmail}`);
    } catch (permErr) {
      // Không block upload nếu cấp quyền thất bại
      console.warn(`[Drive] ⚠️ Cấp quyền TCCB thất bại: ${permErr instanceof Error ? permErr.message : permErr}`);
    }
  }

  return webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
}



export async function deleteFileFromDrive(fileId: string) {
  const drive = await getDriveClient();
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    console.log(`[Drive] Đã xóa file ${fileId}`);
  } catch (error: unknown) {
    console.error(`[Drive] Không thể xóa file ${fileId}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Test nhanh: Liệt kê 10 file trong Folder ID đã cấu hình.
 * Dùng trong /api/admin/test-drive để debug.
 */
export async function listFilesInConfiguredFolder(): Promise<{ id: string; name: string; parents?: string[] }[]> {
  const drive = await getDriveClient();
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!rootFolderId) throw new Error('[Drive] GOOGLE_DRIVE_FOLDER_ID chưa cấu hình');

  console.log(`[Drive] Liệt kê file trong folder: ${rootFolderId}`);

  const result = await drive.files.list({
    q: `'${rootFolderId}' in parents and trashed=false`,
    fields: 'files(id, name, parents)',
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  const files = result.data.files ?? [];
  console.log(`[Drive] Tìm thấy ${files.length} file/folder trong ${rootFolderId}`);
  return files as { id: string; name: string; parents?: string[] }[];
}

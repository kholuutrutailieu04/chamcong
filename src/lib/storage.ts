import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { decodeBase64Image } from '@/lib/image-sync';

const BUCKET_NAME = 'cham_cong_images';

export async function uploadAttendanceImageToStorage(
  admin: SupabaseClient<Database>,
  payload: {
    recordId: string;
    empId: string;
    type: string;
    isTest: boolean;
    rawBase64: string;
  },
) {
  const { buffer, mimeType, extension } = decodeBase64Image(payload.rawBase64);
  const now = new Date();
  const folderType = payload.isTest ? 'test' : 'prod';
  const filePath = `${folderType}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${payload.empId}/${payload.recordId}_${payload.type}_${now.getTime()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicData } = admin.storage.from(BUCKET_NAME).getPublicUrl(filePath);

  return {
    bucket: BUCKET_NAME,
    path: filePath,
    mimeType,
    publicUrl: publicData.publicUrl,
  };
}

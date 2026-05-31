import { requireSupabase } from '@/core/lib/supabase';

const BUCKET_NAME = 'tenant-files';

const DOCUMENT_FOLDERS = {
  identity: 'identity-documents',
  chassis: 'chassis-documents',
  engine: 'engine-documents',
};

function createFileName(extension = 'jpg') {
  const uuid = crypto.randomUUID();
  const safeExtension = String(extension || 'jpg').replace(/^\./, '').toLowerCase();
  return `${uuid}.${safeExtension || 'jpg'}`;
}

export async function uploadQuickImage({ tenantId, documentType, file, extension = 'jpg' }) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة لرفع الصورة.');
  }

  if (!file) {
    throw new Error('اختر صورة أولاً.');
  }

  const folder = DOCUMENT_FOLDERS[documentType];

  if (!folder) {
    throw new Error('نوع الصورة غير صحيح.');
  }

  const client = requireSupabase();
  const path = `${tenantId}/${folder}/${createFileName(extension)}`;
  const { error } = await client.storage.from(BUCKET_NAME).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || 'تعذر رفع الصورة.');
  }

  const { data: signedData } = await client.storage.from(BUCKET_NAME).createSignedUrl(path, 60 * 60);

  return {
    bucket: BUCKET_NAME,
    path,
    signedUrl: signedData?.signedUrl || '',
  };
}

import { requireSupabase } from '@/core/lib/supabase';

const BUCKET_NAME = 'tenant-files';
const SIGNED_URL_EXPIRES_IN = 60 * 60;
const STORAGE_LIST_LIMIT = 1000;

const PHOTO_FOLDERS = [
  { key: 'identity', label: 'صورة بطاقة', folder: 'identity-documents' },
  { key: 'chassis', label: 'صورة رقم شاسيه', folder: 'chassis-documents' },
  { key: 'engine', label: 'صورة رقم موتور', folder: 'engine-documents' },
];

function isImageFile(file) {
  const mimeType = file?.metadata?.mimetype || file?.metadata?.mimeType || '';
  const name = String(file?.name || '').toLowerCase();

  return mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/.test(name);
}

function normalizeStorageFile(file, folderMeta, tenantId) {
  const path = `${tenantId}/${folderMeta.folder}/${file.name}`;

  return {
    id: path,
    name: file.name,
    path,
    type: folderMeta.key,
    typeLabel: folderMeta.label,
    size: Number(file.metadata?.size || 0),
    createdAt: file.created_at || file.updated_at || null,
    updatedAt: file.updated_at || null,
    signedUrl: '',
  };
}

function normalizeFilePath(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^tenant-files\//, '');
}

async function listFolderFiles(client, prefix) {
  const files = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client.storage.from(BUCKET_NAME).list(prefix, {
      limit: STORAGE_LIST_LIMIT,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error) {
      throw error;
    }

    const nextFiles = data || [];
    files.push(...nextFiles);

    if (nextFiles.length < STORAGE_LIST_LIMIT) {
      break;
    }

    offset += STORAGE_LIST_LIMIT;
  }

  return files;
}

export async function listTenantPhotos({ tenantId }) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة لعرض الصور.');
  }

  const client = requireSupabase();
  const folderResults = await Promise.all(
    PHOTO_FOLDERS.map(async (folderMeta) => {
      const prefix = `${tenantId}/${folderMeta.folder}`;
      let data = [];

      try {
        data = await listFolderFiles(client, prefix);
      } catch (listError) {
        throw new Error(listError.message || `تعذر تحميل ${folderMeta.label}.`);
      }

      return (data || [])
        .filter((file) => file?.name && !file.name.startsWith('.') && isImageFile(file))
        .map((file) => normalizeStorageFile(file, folderMeta, tenantId));
    }),
  );

  const photos = folderResults.flat();

  const photosWithUrls = await Promise.all(
    photos.map(async (photo) => {
      const { data } = await client.storage.from(BUCKET_NAME).createSignedUrl(photo.path, SIGNED_URL_EXPIRES_IN);
      return {
        ...photo,
        signedUrl: data?.signedUrl || '',
      };
    }),
  );

  return photosWithUrls.sort((first, second) => {
    const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
    const secondTime = second.createdAt ? new Date(second.createdAt).getTime() : 0;
    return secondTime - firstTime || first.name.localeCompare(second.name, 'ar');
  });
}

export async function listUnlinkedTenantPhotos({ tenantId }) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة لعرض الصور.');
  }

  const client = requireSupabase();
  const [photos, attachmentsResult] = await Promise.all([
    listTenantPhotos({ tenantId }),
    client.from('ir_attachments').select('file_path').eq('tenant_id', tenantId),
  ]);

  if (attachmentsResult.error) {
    throw new Error(attachmentsResult.error.message || 'تعذر تحميل سجلات المرفقات.');
  }

  const attachedPaths = new Set(
    (attachmentsResult.data || [])
      .map((attachment) => normalizeFilePath(attachment.file_path))
      .filter(Boolean),
  );

  return photos.filter((photo) => !attachedPaths.has(normalizeFilePath(photo.path)));
}

export async function deleteTenantPhotos({ paths }) {
  const safePaths = [...new Set((paths || []).filter(Boolean))];

  if (!safePaths.length) {
    throw new Error('حدد صورة واحدة على الأقل للحذف.');
  }

  const client = requireSupabase();
  const { error } = await client.storage.from(BUCKET_NAME).remove(safePaths);

  if (error) {
    throw new Error(error.message || 'تعذر حذف الصور.');
  }

  const prefixes = [...new Set(safePaths.map((path) => path.split('/').slice(0, -1).join('/')).filter(Boolean))];
  const remainingPaths = new Set();

  await Promise.all(
    prefixes.map(async (prefix) => {
      const { data, error: listError } = await client.storage.from(BUCKET_NAME).list(prefix, {
        limit: 1000,
        offset: 0,
      });

      if (listError) {
        throw new Error(listError.message || 'تعذر التأكد من حذف الصور.');
      }

      (data || []).forEach((file) => {
        if (file?.name) {
          remainingPaths.add(`${prefix}/${file.name}`);
        }
      });
    }),
  );

  const stillExistingPaths = safePaths.filter((path) => remainingPaths.has(path));

  if (stillExistingPaths.length) {
    throw new Error('لم يتم حذف بعض الصور من Storage. راجع صلاحيات الحذف على bucket tenant-files.');
  }

  return { deletedCount: safePaths.length };
}

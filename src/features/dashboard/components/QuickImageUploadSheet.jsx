import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ImagePlus, Loader2, UploadCloud, X } from 'lucide-react';
import { Button } from '@/core/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { uploadQuickImage } from '@/features/dashboard/services/quickImageUpload.service';

const MAX_ORIGINAL_FILE_SIZE = 8 * 1024 * 1024;
const MAX_COMPRESSED_FILE_SIZE = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_QUALITY = 0.82;
const OUTPUT_MIME_TYPE = 'image/jpeg';
const OUTPUT_EXTENSION = 'jpg';

const DOCUMENT_TYPES = [
  { value: 'identity', label: 'صورة بطاقة' },
  { value: 'chassis', label: 'صورة رقم شاسيه' },
  { value: 'engine', label: 'صورة رقم موتور' },
];

function formatFileSize(size) {
  if (!size) return '0 KB';
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function validateImageFile(file) {
  if (!file) return 'اختر صورة أولاً.';
  if (!file.type?.startsWith('image/')) return 'يمكن رفع ملفات الصور فقط.';
  if (file.size > MAX_ORIGINAL_FILE_SIZE) return 'حجم الصورة كبير جدًا. الحد الأقصى قبل المعالجة 8MB.';
  return '';
}

function getScaledSize(width, height) {
  const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('تعذر قراءة الصورة. جرّب صورة أخرى.'));
    };
    image.src = objectUrl;
  });
}

async function compressImage(file) {
  const image = await loadImage(file);
  const size = getScaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('المتصفح غير قادر على ضغط الصورة.');
  }

  context.drawImage(image, 0, 0, size.width, size.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('تعذر ضغط الصورة.'));
          return;
        }

        resolve(new File([blob], `${crypto.randomUUID()}.${OUTPUT_EXTENSION}`, { type: OUTPUT_MIME_TYPE }));
      },
      OUTPUT_MIME_TYPE,
      IMAGE_QUALITY,
    );
  });
}

export function QuickImageUploadSheet({ open, onOpenChange, tenantId, onUploaded }) {
  const [documentType, setDocumentType] = useState('identity');
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [compressionInfo, setCompressionInfo] = useState(null);

  const previewUrl = useMemo(() => {
    if (!file) return '';
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!open) {
      setDocumentType('identity');
      setFile(null);
      setIsDragging(false);
      setIsUploading(false);
      setUploadStage('');
      setError('');
      setResult(null);
      setCompressionInfo(null);
    }
  }, [open]);

  const pickFile = (nextFile) => {
    const nextError = validateImageFile(nextFile);
    setResult(null);
    setCompressionInfo(null);

    if (nextError) {
      setFile(null);
      setError(nextError);
      return;
    }

    setFile(nextFile);
    setError('');
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    const nextError = validateImageFile(file);

    if (nextError) {
      setError(nextError);
      return;
    }

    setIsUploading(true);
    setUploadStage('preparing');
    setError('');
    setResult(null);
    setCompressionInfo(null);

    try {
      setUploadStage('compressing');
      const compressedFile = await compressImage(file);
      const nextCompressionInfo = {
        before: file.size,
        after: compressedFile.size,
      };
      setCompressionInfo(nextCompressionInfo);

      if (compressedFile.size > MAX_COMPRESSED_FILE_SIZE) {
        setError(`حجم الصورة بعد الضغط ما زال كبيرًا (${formatFileSize(compressedFile.size)}). الحد الأقصى بعد الضغط 2MB.`);
        return;
      }

      setUploadStage('uploading');
      const uploadResult = await uploadQuickImage({
        tenantId,
        documentType,
        file: compressedFile,
        extension: OUTPUT_EXTENSION,
      });
      setResult(uploadResult);
      onUploaded?.(uploadResult);
    } catch (uploadError) {
      setError(uploadError.message || 'تعذر رفع الصورة.');
    } finally {
      setIsUploading(false);
      setUploadStage('');
    }
  };

  const uploadStageText = {
    preparing: 'جاري تجهيز الصورة',
    compressing: 'جاري ضغط الصورة',
    uploading: 'جاري رفع الصورة',
  }[uploadStage];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-full border-l border-slate-200 bg-white sm:max-w-[520px]" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 py-6 text-right">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.9)]">
              <ImagePlus className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle className="text-2xl font-black text-slate-950">رفع صورة سريع</SheetTitle>
              <p className="mt-1 text-sm font-bold leading-6 text-slate-500">
                رفع مباشر إلى مساحة ملفات الشركة بدون إنشاء سجلات.
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-5 bg-white px-6 py-6">
          <div>
            <label className="mb-2 block text-xs font-black text-slate-500">نوع الصورة</label>
            <select
              value={documentType}
              onChange={(event) => {
                setDocumentType(event.target.value);
                setResult(null);
              }}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <label
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed px-5 py-8 text-center transition ${
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />
            <UploadCloud className={`h-9 w-9 ${isDragging ? 'text-blue-600' : 'text-slate-400'}`} />
            <span className="mt-3 text-sm font-black text-slate-900">صوّر من الهاتف أو اختر صورة</span>
            <span className="mt-1 text-xs font-bold text-slate-500">PNG, JPG, WEBP حتى 8MB قبل الضغط</span>
          </label>

          {file ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="relative aspect-[16/10] bg-slate-100">
                <img src={previewUrl} alt="معاينة الصورة" className="h-full w-full object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                  }}
                  className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/92 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
                  aria-label="إزالة الصورة"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs font-bold text-slate-500">
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="shrink-0">{formatFileSize(file.size)}</span>
              </div>
            </div>
          ) : null}

          {compressionInfo ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-black text-slate-500">قبل الضغط</p>
                <p className="mt-1 text-sm font-black text-slate-950">{formatFileSize(compressionInfo.before)}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                <p className="text-[11px] font-black text-blue-600">بعد الضغط</p>
                <p className="mt-1 text-sm font-black text-slate-950">{formatFileSize(compressionInfo.after)}</p>
              </div>
            </div>
          ) : null}

          {isUploading ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
              <div className="flex items-center gap-3 text-sm font-black text-blue-700">
                <Loader2 className="h-5 w-5 animate-spin" />
                {uploadStageText || 'جاري معالجة الصورة'}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                تم رفع الصورة بنجاح
              </div>
              <div className="rounded-xl bg-white px-3 py-2 text-left font-mono text-xs font-bold text-slate-700" dir="ltr">
                {result.path}
              </div>
              {result.signedUrl ? (
                <a
                  href={result.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-xs font-black text-blue-700 underline underline-offset-4"
                >
                  فتح رابط معاينة مؤقت
                </a>
              ) : null}
            </div>
          ) : null}

          <Button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || !file || !tenantId}
            className="h-12 w-full rounded-2xl bg-slate-950 font-black text-white shadow-[0_18px_32px_-24px_rgba(15,23,42,0.9)] hover:bg-slate-800"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploadStageText || 'جاري الرفع'}
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" />
                رفع الصورة
              </>
            )}
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

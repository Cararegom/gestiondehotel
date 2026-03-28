const EVIDENCE_BUCKET = 'operacion-evidencias';
const MAX_EVIDENCE_FILE_SIZE = 12 * 1024 * 1024;
const EVIDENCE_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

function sanitizeFileName(fileName = 'archivo') {
  return String(fileName || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function guessAttachmentKind(file = {}) {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

function validateFile(file) {
  if (!file) {
    throw new Error('No se recibio ningun archivo.');
  }

  if (file.size > MAX_EVIDENCE_FILE_SIZE) {
    throw new Error(`El archivo ${file.name} supera el limite de 12 MB.`);
  }
}

export function getEvidenceBucketName() {
  return EVIDENCE_BUCKET;
}

export function getEvidenceAcceptString() {
  return EVIDENCE_ACCEPT;
}

export async function uploadEvidenceFiles({
  supabase,
  hotelId,
  userId,
  files = [],
  scope = 'general'
}) {
  const safeFiles = Array.from(files || []).filter(Boolean);
  if (!safeFiles.length) return [];

  const hotelSegment = hotelId || 'sin-hotel';
  const userSegment = userId || 'anonimo';
  const uploaded = [];

  for (const file of safeFiles) {
    validateFile(file);

    const timestamp = Date.now();
    const safeName = sanitizeFileName(file.name);
    const filePath = `${hotelSegment}/${scope}/${userSegment}/${timestamp}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicUrlData } = supabase.storage
      .from(EVIDENCE_BUCKET)
      .getPublicUrl(filePath);

    uploaded.push({
      name: file.name,
      path: filePath,
      url: publicUrlData?.publicUrl || '',
      mime_type: file.type || 'application/octet-stream',
      size: Number(file.size || 0),
      kind: guessAttachmentKind(file),
      uploaded_at: new Date().toISOString()
    });
  }

  return uploaded;
}

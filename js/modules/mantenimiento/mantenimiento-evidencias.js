const MAINTENANCE_EVIDENCE_BUCKET = 'mantenimiento-evidencias';
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
const SIGNED_URL_TTL_SECONDS = 15 * 60;

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
  if (!file) throw new Error('No se recibio ningun archivo.');
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`El archivo ${file.name} supera el limite de 12 MB.`);
  }
}

export function getMaintenanceEvidenceAcceptString() {
  return ACCEPT;
}

export async function uploadMaintenanceEvidence({
  supabase,
  hotelId,
  userId,
  files = [],
  taskRequestId = 'sin-tarea'
}) {
  const safeFiles = Array.from(files || []).filter(Boolean);
  if (!safeFiles.length) return [];
  if (!hotelId) throw new Error('No se pudo identificar el hotel para guardar la evidencia.');

  const userSegment = userId || 'sin-usuario';
  const uploaded = [];

  for (const file of safeFiles) {
    validateFile(file);
    const safeName = sanitizeFileName(file.name);
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const filePath = `${hotelId}/${taskRequestId}/${userSegment}/${uniquePart}_${safeName}`;

    const { error } = await supabase.storage
      .from(MAINTENANCE_EVIDENCE_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    uploaded.push({
      name: file.name,
      path: filePath,
      bucket: MAINTENANCE_EVIDENCE_BUCKET,
      mime_type: file.type || 'application/octet-stream',
      size: Number(file.size || 0),
      kind: guessAttachmentKind(file),
      uploaded_at: new Date().toISOString()
    });
  }

  return uploaded;
}

export async function getMaintenanceEvidenceUrl(supabase, attachment) {
  if (!attachment) return '';

  // Compatibilidad de lectura con evidencias historicas que ya guardaban URL publica.
  if (!attachment.path && attachment.url) return attachment.url;

  const bucket = attachment.bucket || MAINTENANCE_EVIDENCE_BUCKET;
  if (!attachment.path) return attachment.url || '';

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(attachment.path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.warn('No se pudo firmar evidencia de mantenimiento:', error);
    return attachment.url || '';
  }

  return data?.signedUrl || '';
}

export async function hydrateMaintenanceEvidenceUrls(supabase, attachments = []) {
  return Promise.all((attachments || []).map(async (attachment) => ({
    ...attachment,
    display_url: await getMaintenanceEvidenceUrl(supabase, attachment)
  })));
}

export async function deleteMaintenanceEvidence(supabase, attachment) {
  if (!attachment?.path) return;
  const bucket = attachment.bucket || MAINTENANCE_EVIDENCE_BUCKET;
  const { error } = await supabase.storage.from(bucket).remove([attachment.path]);
  if (error) throw error;
}

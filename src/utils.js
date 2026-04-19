import crypto from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function nowMs() {
  return Date.now();
}

export function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function hashCode(value) {
  return crypto.createHash('sha256').update(normalizeCode(value)).digest('hex');
}

export function generateAccessCode() {
  return `${randomFromAlphabet(CODE_ALPHABET, 4)}-${randomFromAlphabet(CODE_ALPHABET, 4)}-${randomFromAlphabet(CODE_ALPHABET, 4)}`;
}

export function generateSlug(prefix = 'quiz') {
  return `${prefix}-${randomFromAlphabet(SLUG_ALPHABET, 10)}`;
}

export function randomToken() {
  return crypto.randomUUID();
}

export function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

export function sanitizeText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUploadedFilename(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  // Browsers may send UTF-8 filename bytes that middleware decodes as latin1,
  // which produces sequences like "Ð—ÐœÐš". Decode only when it looks mojibaked.
  if (!/[ÐÑÃÂ]/.test(input)) {
    return input;
  }

  try {
    const decoded = Buffer.from(input, 'latin1').toString('utf8').trim();
    return decoded || input;
  } catch {
    return input;
  }
}

export function sanitizeFolderName(value) {
  return String(value || 'quiz')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || 'quiz';
}

export function buildAbsoluteUrl(req, pathname) {
  if (process.env.BASE_URL) {
    return new URL(pathname, process.env.BASE_URL).toString();
  }

  return `${req.protocol}://${req.get('host')}${pathname}`;
}

function randomFromAlphabet(alphabet, length) {
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

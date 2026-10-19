// Pure text helpers. No DOM access.
export function cleanLabel(raw, max = 512) {
  if (!raw) return '';
  return String(raw)
    .replace(/\(\s*(optional|required|mandatory)\s*\)/gi, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*$/, '')
    .trim()
    .slice(0, max)
    .trim();
}

const EXAMPLE_RE =
  /^(e\.?g\.?[\s:]|ex(ample)?[\s:]|\d|[xX#]{3,})|^[dmy]{2,4}([/.\-][dmy]{2,4}){1,2}$/i;

// Placeholders like "DD/MM/YYYY" or "9876543210" are format hints, not names.
export function looksLikeExample(s) {
  const t = (s || '').trim();
  if (!t) return false;
  if (EXAMPLE_RE.test(t)) return true;
  if (/@/.test(t) && /\./.test(t)) return true;
  return !/[a-z]{3,}/i.test(t);
}

// Rejects React ids (":r1:"), hex/uuid-like and numbered ids ("input4821").
export function isMeaningfulIdentifier(s) {
  if (!s || s.length < 3 || s.length > 40) return false;
  if (/^:/.test(s) || /^[a-f0-9-]{8,}$/i.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  return /[a-z]{3,}/i.test(s);
}

export function humanizeIdentifier(s) {
  return cleanLabel(
    String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.[\]]+/g, ' ').toLowerCase()
  );
}

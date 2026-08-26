const SECRET_PATTERNS = [
  /\b(bot\d{6,}:[A-Za-z0-9_-]{20,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{20,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /((?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*)([^\s'"`]+)/gi,
  /(Bearer\s+)([A-Za-z0-9._~+\/-]+=*)/gi
];

export function redactSecrets(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      const match = args[0];
      if (/^(Bearer\s+)/i.test(match)) return match.replace(/^(Bearer\s+).+$/i, '$1[REDACTED]');
      if (/[:=]/.test(match) && /(api[_-]?key|token|secret|password|passwd|authorization)/i.test(match)) {
        return match.replace(/([:=]\s*).+$/, '$1[REDACTED]');
      }
      return '[REDACTED]';
    });
  }
  return text;
}

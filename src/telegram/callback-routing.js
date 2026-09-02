export function isSessionsCallbackData(data) {
  const value = String(data || '');
  return value.startsWith('session_') || value.startsWith('native_');
}

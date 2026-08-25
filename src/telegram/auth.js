/**
 * Telegram 관리자 권한을 검증한다.
 * @param {object} from Telegram User 객체
 * @returns {boolean}
 */
export function isAuthorizedUser(from) {
  if (!from || !from.id) {
    return false;
  }

  const adminUserId = process.env.TELEGRAM_ADMIN_USER_ID || process.env.TELEGRAM_ALLOWED_USER_IDS || '';
  if (!adminUserId) {
    console.warn('[Telegram Security] TELEGRAM_ADMIN_USER_ID 환경변수가 설정되지 않았습니다. 모든 요청이 차단됩니다.');
    return false;
  }

  const allowedIds = adminUserId
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const userIdStr = String(from.id);
  const isAllowed = allowedIds.includes(userIdStr);

  if (!isAllowed) {
    console.warn(`[Telegram Security] 비인가 접근 차단: UserID=${userIdStr}`);
  }

  return isAllowed;
}

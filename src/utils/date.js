/**
 * UTC 날짜 문자열을 한국 표준시(KST, Asia/Seoul) 형식으로 변환한다.
 * @param {string} dateStr UTC 날짜 문자열 (예: '2026-08-25 12:20:24' 또는 ISO 형식)
 * @returns {string} 포맷팅된 한국 시간 문자열 (예: '2026. 08. 25. 21:20:24')
 */
export function formatKST(dateStr) {
  if (!dateStr) return '-';

  try {
    const utcStr = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
    const date = new Date(utcStr);

    if (isNaN(date.getTime())) {
      return dateStr;
    }

    return date.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return dateStr;
  }
}

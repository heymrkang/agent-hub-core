export const ScheduleType = Object.freeze({ ONCE: 'ONCE', INTERVAL: 'INTERVAL', DAILY: 'DAILY', WEEKLY: 'WEEKLY' });
export const ScheduleRunStatus = Object.freeze({ QUEUED:'QUEUED', RUNNING:'RUNNING', COMPLETED:'COMPLETED', FAILED:'FAILED', SKIPPED:'SKIPPED', MISSED:'MISSED', CANCELLED:'CANCELLED' });

export function computeNextRun(type, value, timezone = 'Asia/Seoul', from = new Date()) {
  if (type === ScheduleType.ONCE) {
    const d = new Date(value); return Number.isNaN(d.getTime()) || d <= from ? null : d;
  }
  if (type === ScheduleType.INTERVAL) {
    const seconds = Number(value); if (!Number.isFinite(seconds) || seconds < 60) throw new Error('INTERVAL은 최소 60초입니다.');
    return new Date(from.getTime() + seconds * 1000);
  }
  if (type === ScheduleType.DAILY) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('DAILY 시간은 HH:mm 형식이어야 합니다.');
    const [hour, minute] = value.split(':').map(Number);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
    const start = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
    for (let i = 0; i < 26 * 60; i++) {
      const candidate = new Date(start.getTime() + i * 60000);
      const parts = Object.fromEntries(fmt.formatToParts(candidate).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
      if (Number(parts.hour) === hour && Number(parts.minute) === minute) return candidate;
    }
    throw new Error(`Timezone에서 다음 실행 시간을 계산할 수 없습니다: ${timezone}`);
  }
  if (type === ScheduleType.WEEKLY) {
    const match = String(value).trim().match(/^(.+?)\s+([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) throw new Error('WEEKLY는 "화,수,목,금 08:30" 형식이어야 합니다.');
    const dayMap = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
    const rawDays = match[1].replace(/요일/g, '').replace(/\s/g, '');
    const expand = (token) => {
      if (token.includes('~') || token.includes('-')) {
        const parts = token.split(/[~-]/);
        if (parts.length !== 2 || !(parts[0] in dayMap) || !(parts[1] in dayMap)) throw new Error('WEEKLY 요일 범위가 잘못되었습니다.');
        const days = [dayMap[parts[0]]];
        while (days.at(-1) !== dayMap[parts[1]]) {
          days.push((days.at(-1) + 1) % 7);
          if (days.length > 7) throw new Error('WEEKLY 요일 범위가 잘못되었습니다.');
        }
        return days;
      }
      if (!(token in dayMap)) throw new Error('WEEKLY 요일이 잘못되었습니다.');
      return [dayMap[token]];
    };
    const selected = new Set(rawDays.split(',').flatMap(expand));
    const hour = Number(match[2]), minute = Number(match[3]);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const dayNumbers = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const start = Math.floor(from.getTime() / 60000) * 60000 + 60000;
    for (let i = 0; i < 8 * 24 * 60; i++) {
      const candidate = new Date(start + i * 60000);
      const parts = Object.fromEntries(formatter.formatToParts(candidate).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      if (selected.has(dayNumbers[parts.weekday]) && Number(parts.hour) === hour && Number(parts.minute) === minute) return candidate;
    }
    throw new Error(`WEEKLY 다음 실행 시각을 계산할 수 없습니다: ${timezone}`);
  }
  throw new Error(`지원하지 않는 schedule type: ${type}`);
}

export const ScheduleType = Object.freeze({ ONCE: 'ONCE', INTERVAL: 'INTERVAL', DAILY: 'DAILY' });
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
  throw new Error(`지원하지 않는 schedule type: ${type}`);
}

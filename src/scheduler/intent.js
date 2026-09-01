import { providerManager } from '../providers/provider-manager.js';
import { ScheduleType } from './types.js';

export async function extractScheduleIntent(text, activeSession, timezone = 'Asia/Seoul') {
  const simple = parseSimpleKorean(text, activeSession, timezone);
  if (simple) return validateIntent(simple);

  const adapter = providerManager.getAdapter(activeSession.active_provider);
  const prompt = `다음 사용자의 스케줄 등록 요청을 JSON 하나로만 변환하세요. 설명/마크다운 금지.\n현재 timezone: ${timezone}\n현재 시각 ISO: ${new Date().toISOString()}\n허용 schedule_type: ONCE, INTERVAL, DAILY\nINTERVAL schedule_value는 초 단위 문자열(최소 60), DAILY는 HH:mm, ONCE는 ISO-8601 timestamp.\nprovider는 codex 또는 antigravity. model은 명시하지 않으면 null. timeout_seconds는 기본 300.\n반드시 필드: name,schedule_type,schedule_value,timezone,provider,model,execution_profile,prompt,timeout_seconds,needs_clarification,clarification_reason\n모호한 날짜/시간이면 needs_clarification=true로 하세요.\n사용자 요청: ${JSON.stringify(text)}`;
  const result = await adapter.executePrompt({ prompt, model: activeSession.active_model, reasoningEffort: 'default', profile: 'READ_ONLY' });
  const raw = String(result.response || '').trim().replace(/^```json\s*/i, '').replace(/```$/,'').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('스케줄 요청을 구조화하지 못했습니다. 시간을 더 명확하게 입력해주세요.'); }
  if (parsed.needs_clarification) throw new Error(parsed.clarification_reason || '스케줄 시간이 모호합니다.');
  return validateIntent({ ...parsed, timezone: parsed.timezone || timezone, provider: parsed.provider || activeSession.active_provider, model: parsed.model ?? activeSession.active_model, execution_profile: parsed.execution_profile || activeSession.execution_profile });
}

function parseSimpleKorean(text, session, timezone) {
  let m = text.match(/(?:매|매번)\s*(\d+)\s*(분|시간)\s*(?:마다)?\s+(.+)/);
  if (m) {
    const seconds = Number(m[1]) * (m[2] === '시간' ? 3600 : 60);
    return base(`매 ${m[1]}${m[2]}`, ScheduleType.INTERVAL, String(seconds), m[3], session, timezone);
  }
  m = text.match(/(?:매일|매일마다)\s*(?:오전|오후)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:시)?\s+(.+)/);
  if (m) {
    let hour = Number(m[1]); const minute = Number(m[2] || 0);
    if (/오후/.test(text) && hour < 12) hour += 12; if (/오전/.test(text) && hour === 12) hour = 0;
    return base(`매일 ${pad(hour)}:${pad(minute)}`, ScheduleType.DAILY, `${pad(hour)}:${pad(minute)}`, m[3], session, timezone);
  }
  return null;
}
function base(name, type, value, prompt, session, timezone) { return { name, schedule_type:type, schedule_value:value, timezone, provider:session.active_provider, model:session.active_model, execution_profile:session.execution_profile, prompt, timeout_seconds:300 }; }
function pad(n) { return String(n).padStart(2,'0'); }
function validateIntent(i) {
  if (!Object.values(ScheduleType).includes(i.schedule_type)) throw new Error('지원하지 않는 스케줄 형식입니다.');
  if (!i.prompt || !String(i.prompt).trim()) throw new Error('실행할 작업 내용이 없습니다.');
  if (!['codex','antigravity'].includes(String(i.provider).toLowerCase())) throw new Error('지원하지 않는 Provider입니다.');
  try { new Intl.DateTimeFormat('ko-KR', { timeZone: i.timezone || 'Asia/Seoul' }).format(new Date()); } catch { throw new Error('올바르지 않은 timezone입니다.'); }
  return { name:String(i.name || '예약 작업').slice(0,100), schedule_type:i.schedule_type, schedule_value:String(i.schedule_value), timezone:i.timezone || 'Asia/Seoul', provider:String(i.provider).toLowerCase(), model:i.model || null, execution_profile:i.execution_profile || 'WORKSPACE', prompt:String(i.prompt), timeout_seconds:Math.min(Math.max(Number(i.timeout_seconds)||300,10),3600) };
}

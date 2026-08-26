import crypto from 'crypto';
import { getDb } from '../../database/index.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { extractScheduleIntent } from '../../scheduler/intent.js';
import { computeNextRun } from '../../scheduler/types.js';

const pending = new Map();

export async function handleScheduleCommand(bot, msg, args = '') {
  const chatId = msg.chat.id; const userId = msg.from.id; const text = args.trim();
  if (!text) return showScheduleList(bot, chatId, userId);
  if (text === 'help') return bot.sendMessage(chatId, scheduleHelp(), { parse_mode:'Markdown' });

  const active = SessionManager.getActiveSession(userId);
  const timezone = getSetting(`timezone_${userId}`) || getSetting('timezone') || 'Asia/Seoul';
  const wait = await bot.sendMessage(chatId, '⏳ 스케줄 요청을 해석하고 있습니다...');
  try {
    const intent = await extractScheduleIntent(text, active, timezone);
    const next = computeNextRun(intent.schedule_type, intent.schedule_value, intent.timezone, new Date());
    if (!next) throw new Error('다음 실행 시각이 미래가 아닙니다.');
    const token = crypto.randomUUID().slice(0,12);
    pending.set(token, { userId, intent, expiresAt:Date.now()+10*60*1000 });
    const body = `🗓️ **스케줄 등록 확인**\n\n• 이름: **${escapeMd(intent.name)}**\n• 방식: \`${intent.schedule_type}\` / \`${intent.schedule_value}\`\n• Timezone: \`${intent.timezone}\`\n• 다음 실행: \`${formatDate(next,intent.timezone)}\`\n• Provider: \`${intent.provider}\`\n• Model: \`${intent.model || 'CLI Default'}\`\n• Timeout: \`${intent.timeout_seconds}s\`\n\n**작업**\n${escapeMd(intent.prompt)}\n\n등록할까요?`;
    await bot.editMessageText(body, { chat_id:chatId, message_id:wait.message_id, parse_mode:'Markdown', reply_markup:{ inline_keyboard:[[{text:'✅ 등록',callback_data:`schedule_confirm:${token}`},{text:'❌ 취소',callback_data:`schedule_cancel:${token}`}]] } });
  } catch (error) {
    await bot.editMessageText(`❌ 스케줄 해석 실패\n\n${error.message}\n\n${scheduleHelp(false)}`, { chat_id:chatId, message_id:wait.message_id });
  }
}

export async function handleScheduleCallback(bot, q) {
  const data=q.data; const chatId=q.message.chat.id; const userId=q.from.id;
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  if (data.startsWith('schedule_confirm:')) {
    const token=data.split(':')[1]; const item=pending.get(token);
    if (!item || item.userId!==userId || item.expiresAt<Date.now()) return bot.sendMessage(chatId,'❌ 등록 요청이 만료되었습니다. 다시 입력해주세요.');
    pending.delete(token); const s=createSchedule(userId,item.intent);
    return bot.editMessageText(`✅ 스케줄 등록 완료\n\n${s.name}\n다음 실행: ${formatDate(new Date(s.next_run_at),s.timezone)}`, {chat_id:chatId,message_id:q.message.message_id});
  }
  if (data.startsWith('schedule_cancel:')) { pending.delete(data.split(':')[1]); return bot.editMessageText('스케줄 등록을 취소했습니다.',{chat_id:chatId,message_id:q.message.message_id}); }
  const [action,id]=data.split(':');
  const s=getDb().prepare(`SELECT * FROM schedules WHERE id=? AND user_id=? AND kind='USER'`).get(id,userId);
  if (!s) return bot.sendMessage(chatId,'❌ 스케줄을 찾을 수 없습니다.');
  if (action==='schedule_toggle') getDb().prepare(`UPDATE schedules SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END,updated_at=datetime('now') WHERE id=?`).run(id);
  if (action==='schedule_delete') getDb().prepare('DELETE FROM schedules WHERE id=?').run(id);
  if (action==='schedule_run') getDb().prepare(`UPDATE schedules SET enabled=1,next_run_at=?,updated_at=datetime('now') WHERE id=?`).run(new Date().toISOString(),id);
  if (action==='schedule_history') return showHistory(bot,chatId,s,q.message.message_id);
  return showScheduleList(bot,chatId,userId,q.message.message_id);
}

function createSchedule(userId,i) {
  const db=getDb(); const id=crypto.randomUUID(); const next=computeNextRun(i.schedule_type,i.schedule_value,i.timezone,new Date());
  db.prepare(`INSERT INTO schedules(id,user_id,name,kind,schedule_type,schedule_value,timezone,provider,model,execution_profile,prompt,timeout_seconds,enabled,overlap_policy,next_run_at) VALUES(?,?,?,'USER',?,?,?,?,?,?,?,?,1,'SKIP',?)`)
    .run(id,userId,i.name,i.schedule_type,i.schedule_value,i.timezone,i.provider,i.model,i.execution_profile,i.prompt,i.timeout_seconds,next.toISOString());
  return db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
}

async function showScheduleList(bot,chatId,userId,messageId=null) {
  const rows=getDb().prepare(`SELECT * FROM schedules WHERE user_id=? AND kind='USER' ORDER BY created_at DESC LIMIT 20`).all(userId);
  let text='🗓️ **예약 작업**\n\n'; const buttons=[];
  if (!rows.length) text+='등록된 작업이 없습니다.\n\n'+scheduleHelp(false);
  for (const s of rows) {
    text+=`${s.enabled?'🟢':'⚪'} **${escapeMd(s.name)}**\n   ${s.schedule_type} · ${escapeMd(s.schedule_value)} · ${escapeMd(s.provider)}\n   다음: ${s.next_run_at?escapeMd(formatDate(new Date(s.next_run_at),s.timezone)):'없음'}\n\n`;
    buttons.push([{text:s.enabled?'⏸️ 끄기':'▶️ 켜기',callback_data:`schedule_toggle:${s.id}`},{text:'▶️ 지금 실행',callback_data:`schedule_run:${s.id}`}]);
    buttons.push([{text:'📜 기록',callback_data:`schedule_history:${s.id}`},{text:'🗑️ 삭제',callback_data:`schedule_delete:${s.id}`}]);
  }
  const opts={parse_mode:'Markdown',reply_markup:{inline_keyboard:buttons}};
  if (messageId) return bot.editMessageText(text,{chat_id:chatId,message_id:messageId,...opts}).catch(()=>{});
  return bot.sendMessage(chatId,text,opts);
}
async function showHistory(bot,chatId,s,messageId) {
  const runs=getDb().prepare(`SELECT * FROM schedule_runs WHERE schedule_id=? ORDER BY created_at DESC LIMIT 5`).all(s.id);
  let text=`📜 **${escapeMd(s.name)} 최근 실행**\n\n`;
  text+=runs.length?runs.map(r=>`• \`${r.status}\` ${escapeMd(r.created_at)}${r.error_message?`\n  ${escapeMd(r.error_message.slice(0,150))}`:''}${r.output_summary?`\n  ${escapeMd(r.output_summary.slice(0,200))}`:''}`).join('\n\n'):'실행 기록이 없습니다.';
  return bot.editMessageText(text,{chat_id:chatId,message_id:messageId,parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔙 목록',callback_data:`schedule_toggleback:${s.id}`}]]}}).catch(()=>{});
}
function getSetting(key){return getDb().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value||null;}
function formatDate(d,tz){try{return new Intl.DateTimeFormat('ko-KR',{timeZone:tz,dateStyle:'short',timeStyle:'medium'}).format(d);}catch{return d.toISOString();}}
function escapeMd(v){return String(v??'').replace(/([_*`\[])/g,'\\$1');}
function scheduleHelp(markdown=true){const s='사용법: /schedule 매 10분마다 서버 상태 확인\n예: /schedule 매일 오전 8시 오늘 할 일 정리';return markdown?`**${s}**`:s;}

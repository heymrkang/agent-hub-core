import { SessionManager } from '../../sessions/session-manager.js';
import { providerManager } from '../../providers/provider-manager.js';
import { modelCatalog } from '../../providers/model-catalog.js';
import { HandoffManager } from '../../context/handoff-manager.js';

export async function handleModelCommand(bot, msg) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id; const userId = msg.from.id;
  try {
    const active = SessionManager.getActiveSession(userId); const providers = providerManager.listProviderNames();
    let text=`🤖 **모델 및 프로바이더 설정**\n\n📌 **활성 세션**: **${active.title}**\n• 현재 Provider: \`${active.active_provider}\`\n• 현재 Model: \`${active.active_model||'기본 모델 (CLI Default)'}\`\n\n변경할 Provider를 선택하세요:`;
    const buttons=providers.map(p=>[{text:p===active.active_provider?`🟢 ${p.toUpperCase()} (선택됨)`:`⚪ ${p.toUpperCase()}`,callback_data:`model_provider:${p}`}]);
    const options={parse_mode:'Markdown',reply_markup:{inline_keyboard:buttons}};
    if (msg.message_id && !msg.chat) await bot.editMessageText(text,{chat_id:chatId,message_id:msg.message.message_id,...options}).catch(e=>{if(!e.message.includes('message is not modified'))throw e;});
    else await bot.sendMessage(chatId,text,options);
  } catch(error){ console.error(`[Command /model Error] ${error.message}`); await bot.sendMessage(chatId,`❌ 모델 설정 실패: ${error.message}`); }
}

async function showModelsForProvider(bot,q,providerName) {
  const chatId=q.message.chat.id,messageId=q.message.message_id,userId=q.from.id;
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  const active=SessionManager.getActiveSession(userId); const models=modelCatalog.getModels(providerName); const state=modelCatalog.getCacheState(providerName);
  if (!models.length) {
    const text=`📭 **[${providerName.toUpperCase()}] 모델 캐시가 비어 있습니다.**\n\n아직 백그라운드 조회가 완료되지 않았거나 마지막 조회가 실패했습니다.${state.last_error?`\n\n최근 오류: ${escapeMd(state.last_error.slice(0,300))}`:''}`;
    return bot.editMessageText(text,{chat_id:chatId,message_id:messageId,parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 지금 조회',callback_data:`model_refresh:${providerName}`}],[{text:'🔙 Provider 목록으로',callback_data:'model_back_to_providers'}]]}}).catch(()=>{});
  }
  const age=state.last_success_at?formatAge(state.last_success_at):'알 수 없음';
  let text=`🎛️ **[${providerName.toUpperCase()}] 지원 모델 목록**\n\n📌 **활성 세션**: **${active.title}**\n📦 캐시: \`${state.status}\` · 마지막 갱신: \`${age}\`\n\n원하는 모델을 선택하세요:`;
  const buttons=models.map(m=>[{text:`${active.active_provider===providerName&&active.active_model===m.id?'🟢 ':'⚪ '}${m.name}`,callback_data:`model_select:${providerName}:${m.id}`}]);
  buttons.push([{text:'🔄 모델 목록 새로고침',callback_data:`model_refresh:${providerName}`},{text:'🔙 Provider 목록',callback_data:'model_back_to_providers'}]);
  await bot.editMessageText(text,{chat_id:chatId,message_id:messageId,parse_mode:'Markdown',reply_markup:{inline_keyboard:buttons}}).catch(()=>{});
}

async function refreshModels(bot,q,providerName){
  const chatId=q.message.chat.id,messageId=q.message.message_id;
  await bot.answerCallbackQuery(q.id,{text:'백그라운드 모델 조회를 시작합니다.'}).catch(()=>{});
  await bot.editMessageText(`⏳ **[${providerName.toUpperCase()}] 모델 목록 갱신 중...**\n\n기존 캐시는 유지됩니다.`,{chat_id:chatId,message_id:messageId,parse_mode:'Markdown'}).catch(()=>{});
  try { await modelCatalog.refresh(providerName,{force:true}); return showModelsForProvider(bot,{...q,id:'already-acked'},providerName); }
  catch(error){ const cached=modelCatalog.getModels(providerName); const suffix=cached.length?'\n\n기존 캐시는 유지했습니다.':'\n\n사용 가능한 기존 캐시가 없습니다.'; await bot.editMessageText(`❌ **모델 갱신 실패**\n\n${escapeMd(error.message)}${suffix}`,{chat_id:chatId,message_id:messageId,parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 다시 시도',callback_data:`model_refresh:${providerName}`}],[{text:'🔙 Provider 목록',callback_data:'model_back_to_providers'}]]}}).catch(()=>{}); }
}

async function showSuccess(bot,q,providerName,modelId){const active=SessionManager.getActiveSession(q.from.id);return bot.editMessageText(`✅ **모델 설정 완료**\n\n📌 **세션**: **${active.title}**\n🤖 **Provider**: \`${providerName.toUpperCase()}\`\n🧠 **Model**: \`${modelId}\``,{chat_id:q.message.chat.id,message_id:q.message.message_id,parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 다른 모델로 변경',callback_data:`model_provider:${providerName}`}]]}}).catch(()=>{});}

export async function handleModelCallback(bot,q){
  const data=q.data,userId=q.from.id;
  if(data==='model_back_to_providers'){await handleModelCommand(bot,q);await bot.answerCallbackQuery(q.id).catch(()=>{});return;}
  if(data.startsWith('model_provider:'))return showModelsForProvider(bot,q,data.replace('model_provider:',''));
  if(data.startsWith('model_refresh:'))return refreshModels(bot,q,data.replace('model_refresh:',''));
  if(data.startsWith('model_select:')){
    const parts=data.replace('model_select:','').split(':'),providerName=parts.shift(),modelId=parts.join(':');
    const cached=modelCatalog.getModels(providerName); if(!cached.some(m=>m.id===modelId)) return bot.answerCallbackQuery(q.id,{text:'캐시에 없는 모델입니다. 새로고침 후 다시 선택해주세요.',show_alert:true}).catch(()=>{});
    const active=SessionManager.getActiveSession(userId);
    try{await HandoffManager.executeHandoff({sessionId:active.id,fromProvider:active.active_provider,toProvider:providerName,targetModel:modelId});await bot.answerCallbackQuery(q.id,{text:'모델 적용 완료'}).catch(()=>{});return showSuccess(bot,q,providerName,modelId);}
    catch(error){await bot.answerCallbackQuery(q.id,{text:`변경 실패: ${error.message}`,show_alert:true}).catch(()=>{});}
  }
}
function formatAge(sqlDate){const t=Date.parse(sqlDate.replace(' ','T')+'Z');if(!Number.isFinite(t))return sqlDate;const m=Math.max(0,Math.floor((Date.now()-t)/60000));if(m<1)return'방금 전';if(m<60)return`${m}분 전`;const h=Math.floor(m/60);return h<24?`${h}시간 전`:`${Math.floor(h/24)}일 전`;}
function escapeMd(v){return String(v??'').replace(/([_*`\[])/g,'\\$1');}

import crypto from 'crypto';
import { getSettingsManager } from '../../settings/settings-manager.js';
import { modelCatalog } from '../../providers/model-catalog.js';
import { isStealthMode } from '../renderer/ui-theme.js';

const TIMEZONES = ['Asia/Seoul', 'UTC', 'Asia/Tokyo', 'America/New_York'];
const CONCURRENCY = [1, 2, 4, 8];
const PREVIEW_LIMITS = [1, 2, 3];
const PREVIEW_TIMEOUTS = [6, 12, 24, 48, 0];

function sourceInfo(source) {
  return {
    chatId: source.chat ? source.chat.id : source.message.chat.id,
    messageId: source.chat ? null : source.message?.message_id
  };
}

function mark(selected, label) {
  return `${selected ? '✓ ' : ''}${label}`;
}

function heading(label) {
  return `${isStealthMode() ? '■' : '⚙️'} **${label}**`;
}

function modelToken(modelId) {
  return crypto.createHash('sha256').update(String(modelId)).digest('hex').slice(0, 16);
}

function escapeMd(value) {
  return String(value ?? '').replace(/([_*`\[])/g, '\\$1');
}

function formatAge(sqlDate) {
  if (!sqlDate) return '알 수 없음';
  const t = Date.parse(sqlDate.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return sqlDate;
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

async function editSettingsMessage(bot, source, text, keyboard) {
  const { chatId, messageId } = sourceInfo(source);
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((error) => {
      if (!/message is not modified/i.test(error.message)) throw error;
    });
  }
  return bot.sendMessage(chatId, text, options);
}

async function renderDefaultModels(bot, source, providerName) {
  const settings = getSettingsManager();
  const models = modelCatalog.getModels(providerName);
  const state = modelCatalog.getCacheState(providerName);
  const selectedModel = settings.get(`default_model_${providerName}`);

  if (!models.length) {
    const text = `${heading(`Settings · ${providerName.toUpperCase()} 기본 모델`)}\n\n모델 캐시가 비어 있습니다. 아직 조회가 완료되지 않았거나 마지막 조회가 실패했습니다.${state.last_error ? `\n\n최근 오류: ${escapeMd(state.last_error.slice(0, 300))}` : ''}`;
    return editSettingsMessage(bot, source, text, [
      [{ text: '↻ 지금 조회', callback_data: `settings_model_refresh:${providerName}` }],
      [{ text: '‹ Agent 기본값', callback_data: 'settings_view:agent' }]
    ]);
  }

  const age = state.last_success_at ? formatAge(state.last_success_at) : '알 수 없음';
  const text = `${heading(`Settings · ${providerName.toUpperCase()} 기본 모델`)}\n\n캐시: \`${state.status}\` · 마지막 갱신: \`${age}\`\n\n새 세션에 사용할 모델을 선택하세요. 모델 선택 후 Thinking을 설정합니다.`;
  const buttons = models.map((model) => ([{
    text: mark(selectedModel === model.id, `${model.name}${model.isDefault ? ' · Default' : ''}`),
    callback_data: `settings_model_pick:${providerName}:${modelToken(model.id)}`
  }]));
  buttons.push([
    { text: '↻ 새로고침', callback_data: `settings_model_refresh:${providerName}` },
    { text: '‹ Agent 기본값', callback_data: 'settings_view:agent' }
  ]);
  return editSettingsMessage(bot, source, text, buttons);
}

async function showDefaultModels(bot, q, providerName) {
  await bot.answerCallbackQuery(q.id).catch(() => {});
  if (!modelCatalog.hasReasoningMetadata(providerName)) {
    try {
      await modelCatalog.ensureReasoningMetadata(providerName);
    } catch (error) {
      console.warn(`[Settings Model] ${providerName} Thinking metadata 보강 실패: ${error.message}`);
    }
  }
  return renderDefaultModels(bot, q, providerName);
}

async function refreshDefaultModels(bot, q, providerName) {
  await bot.answerCallbackQuery(q.id, { text: '모델 목록을 갱신합니다.' }).catch(() => {});
  await editSettingsMessage(bot, q, `${heading(`Settings · ${providerName.toUpperCase()} 기본 모델`)}\n\n모델 목록 갱신 중...`, []);
  try {
    await modelCatalog.refresh(providerName, { force: true });
    return renderDefaultModels(bot, q, providerName);
  } catch (error) {
    const cached = modelCatalog.getModels(providerName);
    const suffix = cached.length ? '\n\n기존 캐시는 유지했습니다.' : '\n\n사용 가능한 기존 캐시가 없습니다.';
    return editSettingsMessage(bot, q, `${heading('모델 갱신 실패')}\n\n${escapeMd(error.message)}${suffix}`, [
      [{ text: '↻ 다시 시도', callback_data: `settings_model_refresh:${providerName}` }],
      [{ text: '‹ Agent 기본값', callback_data: 'settings_view:agent' }]
    ]);
  }
}

async function renderDefaultThinking(bot, q, providerName, model) {
  const settings = getSettingsManager();
  const { levels, providerDefault } = modelCatalog.getReasoningOptions(providerName, model.id);
  const selectedModel = settings.get(`default_model_${providerName}`);
  const selectedEffort = settings.get(`default_reasoning_effort_${providerName}`) || 'default';
  const text = `${heading('Settings · 기본 Thinking')}\n\nProvider: \`${providerName}\`\nModel: \`${escapeMd(model.name)}\`\nProvider Default: \`${providerDefault || '미공개'}\`\n\n해당 모델이 지원하는 Thinking만 표시합니다.`;
  const buttons = levels.map((level) => ([{
    text: mark(selectedModel === model.id && selectedEffort === level, level),
    callback_data: `settings_model_apply:${providerName}:${modelToken(model.id)}:${level}`
  }]));
  buttons.push([{ text: '‹ 모델 목록', callback_data: `settings_models:${providerName}` }]);
  return editSettingsMessage(bot, q, text, buttons);
}

async function render(bot, source, view = 'root') {
  const settings = getSettingsManager();
  const values = settings.getAll();
  let text;
  let keyboard;

  if (view === 'agent') {
    const provider = values.default_provider;
    const model = values[`default_model_${provider}`] || 'CLI Default';
    const reasoning = values[`default_reasoning_effort_${provider}`] || 'default';
    text = `${heading('Settings · Agent 기본값')}\n\n새 세션 생성 시 적용됩니다.\n\nProvider: \`${provider}\`\nModel: \`${escapeMd(model)}\`\nThinking: \`${escapeMd(reasoning)}\`\nProfile: \`${values.default_execution_profile}\``;
    keyboard = [
      [
        { text: mark(provider === 'codex', 'CODEX'), callback_data: 'settings_set:default_provider:codex' },
        { text: mark(provider === 'antigravity', 'ANTIGRAVITY'), callback_data: 'settings_set:default_provider:antigravity' }
      ],
      [{ text: '모델 / Thinking 선택', callback_data: `settings_models:${provider}` }],
      ...['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'].map((profile) => ([{
        text: mark(values.default_execution_profile === profile, profile),
        callback_data: `settings_set:default_execution_profile:${profile}`
      }])),
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'execution') {
    text = `${heading('Settings · 실행 설정')}\n\nConcurrency: \`${values.concurrency_limit}\`\nAuto Session Title: \`${values.auto_session_title ? 'ON' : 'OFF'}\``;
    keyboard = [
      CONCURRENCY.map((value) => ({ text: mark(values.concurrency_limit === value, `동시 ${value}`), callback_data: `settings_set:concurrency_limit:${value}` })),
      [{ text: `자동 제목 ${values.auto_session_title ? 'ON' : 'OFF'}`, callback_data: `settings_set:auto_session_title:${!values.auto_session_title}` }],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'telegram') {
    text = `${heading('Settings · Telegram UI')}\n\nNotifications: \`${values.notifications_enabled ? 'ON' : 'OFF'}\`\nUI Mode: \`${values.stealth_mode}\`\n\nSTEALTH는 Agent Hub 명령/UI를 단색 기호와 텍스트 중심으로 표시합니다.`;
    keyboard = [
      [{ text: `Notifications ${values.notifications_enabled ? 'ON' : 'OFF'}`, callback_data: `settings_set:notifications_enabled:${!values.notifications_enabled}` }],
      [
        { text: mark(values.stealth_mode === 'NORMAL', 'NORMAL'), callback_data: 'settings_set:stealth_mode:NORMAL' },
        { text: mark(values.stealth_mode === 'STEALTH', 'STEALTH'), callback_data: 'settings_set:stealth_mode:STEALTH' }
      ],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'scheduler') {
    text = `${heading('Settings · Scheduler')}\n\nTimezone: \`${values.timezone}\`\n\nTimezone 변경은 신규 시간 해석/표시의 기본값으로 사용됩니다.`;
    keyboard = [
      ...TIMEZONES.map((timezone) => ([{
        text: mark(values.timezone === timezone, timezone),
        callback_data: `settings_set:timezone:${timezone}`
      }])),
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'preview') {
    const timeout = values.preview_idle_timeout_hours === 0 ? '수동 종료만' : `${values.preview_idle_timeout_hours}시간`;
    text = `${heading('Settings · Preview')}\n\nIdle Timeout: \`${timeout}\`\nMax Concurrent: \`${values.preview_max_concurrent}\`\n\n동시 실행 제한은 최대 3개입니다.`;
    keyboard = [
      PREVIEW_TIMEOUTS.map((value) => ({ text: mark(values.preview_idle_timeout_hours === value, value === 0 ? '수동' : `${value}h`), callback_data: `settings_set:preview_idle_timeout_hours:${value}` })),
      PREVIEW_LIMITS.map((value) => ({ text: mark(values.preview_max_concurrent === value, `최대 ${value}`), callback_data: `settings_set:preview_max_concurrent:${value}` })),
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'system') {
    const provider = values.default_provider;
    text = `${heading('Settings · 시스템 설정')}\n\nProvider: \`${provider}\`\nModel: \`${escapeMd(values[`default_model_${provider}`] || 'CLI Default')}\`\nThinking: \`${escapeMd(values[`default_reasoning_effort_${provider}`] || 'default')}\`\nProfile: \`${values.default_execution_profile}\`\nConcurrency: \`${values.concurrency_limit}\`\nPreview: \`${values.preview_max_concurrent}개 / ${values.preview_idle_timeout_hours === 0 ? '수동 종료' : `${values.preview_idle_timeout_hours}h`}\`\nNotifications: \`${values.notifications_enabled ? 'ON' : 'OFF'}\`\nUI: \`${values.stealth_mode}\`\nTimezone: \`${values.timezone}\`\n\n전체 기본값 복원은 확인 후 실행됩니다.`;
    keyboard = [
      [{ text: '기본값 복원', callback_data: 'settings_reset_confirm' }],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'reset_confirm') {
    text = `${isStealthMode() ? '!' : '⚠️'} **Settings 초기화 확인**\n\nPhase 10에서 관리하는 설정을 모두 기본값으로 복원합니다.\n세션/메시지/스케줄/SSH 정보는 삭제하지 않습니다.`;
    keyboard = [
      [{ text: '초기화 실행', callback_data: 'settings_reset_all' }],
      [{ text: '취소', callback_data: 'settings_view:system' }]
    ];
  } else {
    text = `${heading('Agent Hub Settings')}\n\n영속 설정을 관리합니다. 변경 내용은 SQLite에 저장되어 재배포 후에도 유지됩니다.`;
    keyboard = [
      [{ text: 'Agent 기본값', callback_data: 'settings_view:agent' }],
      [{ text: '실행 설정', callback_data: 'settings_view:execution' }],
      [{ text: 'Telegram UI', callback_data: 'settings_view:telegram' }],
      [{ text: 'Scheduler', callback_data: 'settings_view:scheduler' }],
      [{ text: 'Preview', callback_data: 'settings_view:preview' }],
      [{ text: '시스템 설정', callback_data: 'settings_view:system' }]
    ];
  }

  return editSettingsMessage(bot, source, text, keyboard);
}

export async function handleSettingsCommand(bot, msg) {
  try {
    await render(bot, msg, 'root');
  } catch (error) {
    console.error(`[Command /settings Error] ${error.message}`);
    await bot.sendMessage(msg.chat.id, `${isStealthMode() ? '×' : '❌'} Settings 조회 실패: ${error.message}`);
  }
}

export async function handleSettingsCallback(bot, q) {
  const data = q.data || '';
  try {
    if (data.startsWith('settings_view:')) {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return render(bot, q, data.slice('settings_view:'.length));
    }
    if (data.startsWith('settings_models:')) {
      return showDefaultModels(bot, q, data.slice('settings_models:'.length));
    }
    if (data.startsWith('settings_model_refresh:')) {
      return refreshDefaultModels(bot, q, data.slice('settings_model_refresh:'.length));
    }
    if (data.startsWith('settings_model_pick:')) {
      const [, providerName, token] = data.split(':');
      const selected = modelCatalog.getModels(providerName).find((model) => modelToken(model.id) === token);
      if (!selected) return bot.answerCallbackQuery(q.id, { text: '모델 캐시가 갱신되었습니다. 목록을 다시 열어 선택해주세요.', show_alert: true }).catch(() => {});
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return renderDefaultThinking(bot, q, providerName, selected);
    }
    if (data.startsWith('settings_model_apply:')) {
      const [, providerName, token, effort] = data.split(':');
      const selected = modelCatalog.getModels(providerName).find((model) => modelToken(model.id) === token);
      if (!selected) return bot.answerCallbackQuery(q.id, { text: '모델 캐시가 갱신되었습니다. 다시 선택해주세요.', show_alert: true }).catch(() => {});
      const validated = modelCatalog.validateReasoningEffort(providerName, selected.id, effort);
      const settings = getSettingsManager();
      settings.set(`default_model_${providerName}`, selected.id);
      settings.set(`default_reasoning_effort_${providerName}`, validated);
      await bot.answerCallbackQuery(q.id, { text: '기본 Model / Thinking 저장 완료' }).catch(() => {});
      return render(bot, q, 'agent');
    }
    if (data === 'settings_reset_confirm') {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return render(bot, q, 'reset_confirm');
    }
    if (data === 'settings_reset_all') {
      getSettingsManager().resetAll();
      await bot.answerCallbackQuery(q.id, { text: '설정을 기본값으로 복원했습니다.' }).catch(() => {});
      return render(bot, q, 'root');
    }
    if (data.startsWith('settings_set:')) {
      const payload = data.slice('settings_set:'.length);
      const separator = payload.indexOf(':');
      if (separator < 1) throw new Error('잘못된 설정 요청입니다.');
      const key = payload.slice(0, separator);
      const value = payload.slice(separator + 1);
      getSettingsManager().set(key, value);
      await bot.answerCallbackQuery(q.id, { text: '설정이 저장되었습니다.' }).catch(() => {});
      const view = key.startsWith('default_') ? 'agent'
        : ['concurrency_limit', 'auto_session_title'].includes(key) ? 'execution'
          : ['notifications_enabled', 'stealth_mode'].includes(key) ? 'telegram'
            : key === 'timezone' ? 'scheduler'
              : key.startsWith('preview_') ? 'preview' : 'root';
      return render(bot, q, view);
    }
  } catch (error) {
    console.error(`[Settings Callback Error] ${error.message}`);
    try { await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`.slice(0, 180), show_alert: true }); } catch {}
  }
}

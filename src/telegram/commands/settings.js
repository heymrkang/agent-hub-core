import { getSettingsManager } from '../../settings/settings-manager.js';

const TIMEZONES = ['Asia/Seoul', 'UTC', 'Asia/Tokyo', 'America/New_York'];
const CONCURRENCY = [1, 2, 4, 8];
const COMPACT_THRESHOLDS = [60, 70, 80, 90];

function sourceInfo(source) {
  return {
    chatId: source.chat ? source.chat.id : source.message.chat.id,
    messageId: source.chat ? null : source.message?.message_id
  };
}

function mark(selected, label) {
  return `${selected ? '✓ ' : ''}${label}`;
}

async function render(bot, source, view = 'root') {
  const settings = getSettingsManager();
  const values = settings.getAll();
  const { chatId, messageId } = sourceInfo(source);
  let text;
  let keyboard;

  if (view === 'agent') {
    text = `⚙️ **Settings · Agent 기본값**\n\n새 세션 생성 시 적용됩니다.\n\nProvider: \`${values.default_provider}\`\nProfile: \`${values.default_execution_profile}\`\nCodex Model: \`${values.default_model_codex || 'CLI Default'}\`\nAntigravity Model: \`${values.default_model_antigravity || 'CLI Default'}\``;
    keyboard = [
      [
        { text: mark(values.default_provider === 'codex', 'CODEX'), callback_data: 'settings_set:default_provider:codex' },
        { text: mark(values.default_provider === 'antigravity', 'ANTIGRAVITY'), callback_data: 'settings_set:default_provider:antigravity' }
      ],
      ...['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'].map((profile) => ([{
        text: mark(values.default_execution_profile === profile, profile),
        callback_data: `settings_set:default_execution_profile:${profile}`
      }])),
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'execution') {
    text = `⚙️ **Settings · 실행 설정**\n\nConcurrency: \`${values.concurrency_limit}\`\nAuto Compact: \`${values.auto_compact_threshold}%\`\nAuto Session Title: \`${values.auto_session_title ? 'ON' : 'OFF'}\``;
    keyboard = [
      CONCURRENCY.map((value) => ({ text: mark(values.concurrency_limit === value, `동시 ${value}`), callback_data: `settings_set:concurrency_limit:${value}` })),
      COMPACT_THRESHOLDS.map((value) => ({ text: mark(values.auto_compact_threshold === value, `${value}%`), callback_data: `settings_set:auto_compact_threshold:${value}` })),
      [{ text: `자동 제목 ${values.auto_session_title ? 'ON' : 'OFF'}`, callback_data: `settings_set:auto_session_title:${!values.auto_session_title}` }],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'telegram') {
    text = `⚙️ **Settings · Telegram UI**\n\nNotifications: \`${values.notifications_enabled ? 'ON' : 'OFF'}\`\nUI Mode: \`${values.stealth_mode}\`\n\nSTEALTH는 Agent Hub 명령/UI를 단색 기호와 텍스트 중심으로 표시합니다.`;
    keyboard = [
      [{ text: `Notifications ${values.notifications_enabled ? 'ON' : 'OFF'}`, callback_data: `settings_set:notifications_enabled:${!values.notifications_enabled}` }],
      [
        { text: mark(values.stealth_mode === 'NORMAL', 'NORMAL'), callback_data: 'settings_set:stealth_mode:NORMAL' },
        { text: mark(values.stealth_mode === 'STEALTH', 'STEALTH'), callback_data: 'settings_set:stealth_mode:STEALTH' }
      ],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'scheduler') {
    text = `⚙️ **Settings · Scheduler**\n\nTimezone: \`${values.timezone}\`\n\nTimezone 변경은 신규 시간 해석/표시의 기본값으로 사용됩니다.`;
    keyboard = [
      ...TIMEZONES.map((timezone) => ([{
        text: mark(values.timezone === timezone, timezone),
        callback_data: `settings_set:timezone:${timezone}`
      }])),
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'system') {
    text = `⚙️ **Settings · 시스템 설정**\n\nProvider: \`${values.default_provider}\`\nProfile: \`${values.default_execution_profile}\`\nConcurrency: \`${values.concurrency_limit}\`\nCompact: \`${values.auto_compact_threshold}%\`\nNotifications: \`${values.notifications_enabled ? 'ON' : 'OFF'}\`\nUI: \`${values.stealth_mode}\`\nTimezone: \`${values.timezone}\`\n\n전체 기본값 복원은 확인 후 실행됩니다.`;
    keyboard = [
      [{ text: '기본값 복원', callback_data: 'settings_reset_confirm' }],
      [{ text: '‹ 뒤로', callback_data: 'settings_view:root' }]
    ];
  } else if (view === 'reset_confirm') {
    text = `⚠️ **Settings 초기화 확인**\n\nPhase 10에서 관리하는 설정을 모두 기본값으로 복원합니다.\n세션/메시지/스케줄/SSH 정보는 삭제하지 않습니다.`;
    keyboard = [
      [{ text: '초기화 실행', callback_data: 'settings_reset_all' }],
      [{ text: '취소', callback_data: 'settings_view:system' }]
    ];
  } else {
    text = `⚙️ **Agent Hub Settings**\n\n영속 설정을 관리합니다. 변경 내용은 SQLite에 저장되어 재배포 후에도 유지됩니다.`;
    keyboard = [
      [{ text: 'Agent 기본값', callback_data: 'settings_view:agent' }],
      [{ text: '실행 설정', callback_data: 'settings_view:execution' }],
      [{ text: 'Telegram UI', callback_data: 'settings_view:telegram' }],
      [{ text: 'Scheduler', callback_data: 'settings_view:scheduler' }],
      [{ text: '시스템 설정', callback_data: 'settings_view:system' }]
    ];
  }

  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((error) => {
      if (!/message is not modified/i.test(error.message)) throw error;
    });
  }
  return bot.sendMessage(chatId, text, options);
}

export async function handleSettingsCommand(bot, msg) {
  try {
    await render(bot, msg, 'root');
  } catch (error) {
    console.error(`[Command /settings Error] ${error.message}`);
    await bot.sendMessage(msg.chat.id, `❌ Settings 조회 실패: ${error.message}`);
  }
}

export async function handleSettingsCallback(bot, q) {
  const data = q.data || '';
  try {
    if (data.startsWith('settings_view:')) {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return render(bot, q, data.slice('settings_view:'.length));
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
        : ['concurrency_limit', 'auto_compact_threshold', 'auto_session_title'].includes(key) ? 'execution'
          : ['notifications_enabled', 'stealth_mode'].includes(key) ? 'telegram'
            : key === 'timezone' ? 'scheduler' : 'root';
      return render(bot, q, view);
    }
  } catch (error) {
    console.error(`[Settings Callback Error] ${error.message}`);
    try { await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`.slice(0, 180), show_alert: true }); } catch {}
  }
}

import { BackupManager } from '../../backup/backup-manager.js';
import { isStealthMode, uiTitle } from '../renderer/ui-theme.js';

function fmtBytes(n) {
  const v = Number(n || 0); if (!v) return '-';
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}
function esc(v) { return String(v ?? '').replace(/([_*`\[])/g, '\\$1'); }

export async function handleBackupCommand(bot, msg, arg = '') {
  const chatId = msg.chat.id;
  const cmd = String(arg || '').trim().toLowerCase();
  try {
    if (cmd === 'core') {
      const wait = await bot.sendMessage(chatId, isStealthMode() ? '■ Core backup 생성 중...' : '💾 Core backup 생성 중...');
      const result = await BackupManager.createCoreBackup({ reason: 'telegram-manual' });
      return bot.editMessageText(`${isStealthMode() ? '✓' : '✅'} Core backup 완료\n${esc(result.path)}\n${fmtBytes(result.sizeBytes)}`, { chat_id: chatId, message_id: wait.message_id });
    }
    if (cmd === 'full') {
      const wait = await bot.sendMessage(chatId, isStealthMode() ? '■ Full backup 생성 중...' : '📦 Full backup 생성 중...');
      const result = await BackupManager.createFullBackup({ reason: 'telegram-manual' });
      return bot.editMessageText(`${isStealthMode() ? '✓' : '✅'} Full backup 완료\n${esc(result.path)}\n${fmtBytes(result.sizeBytes)}\n\nSSH private keys / logs / backup archive 자체는 제외됩니다.`, { chat_id: chatId, message_id: wait.message_id });
    }
    if (cmd === 'list') {
      const rows = BackupManager.list(15);
      let text = `${uiTitle('🗄️', 'Backups')}\n\n`;
      text += rows.length ? rows.map((r) => `${r.type} · ${r.status} · ${fmtBytes(r.size_bytes)}\n${esc(r.created_at)} · ${esc(r.path)}`).join('\n\n') : '백업 기록이 없습니다.';
      return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }
    if (cmd === 'status') {
      const s = BackupManager.getStatus();
      let text = `${uiTitle('🗄️', 'Backup Status')}\n\nCore retention: **${s.retention}**\n완료 Core backup: **${s.coreCompleted}**\n`;
      text += `Latest Core: ${s.latestCore ? `${esc(s.latestCore.status)} · ${esc(s.latestCore.created_at)}` : '없음'}\n`;
      text += `Latest Full: ${s.latestFull ? `${esc(s.latestFull.status)} · ${esc(s.latestFull.created_at)}` : '없음'}`;
      return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }
    const text = `${uiTitle('🗄️', 'Backup')}\n\n` +
      '`/backup core` — 안전한 SQLite Core snapshot 즉시 생성\n' +
      '`/backup full` — /data + /workspace Full archive 생성\n' +
      '`/backup list` — 최근 백업 목록\n' +
      '`/backup status` — retention / 최신 상태\n\n' +
      'Core backup은 DB 안의 Memory/Settings/critical metadata를 포함합니다.\nFull backup도 SSH private keys와 logs는 기본 제외합니다.';
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (error) {
    return bot.sendMessage(chatId, `${isStealthMode() ? '×' : '❌'} Backup 실패: ${error.message}`);
  }
}

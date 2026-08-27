import { JobStatus } from '../../jobs/types.js';
import { isStealthMode } from './ui-theme.js';

export class JobStatusRenderer {
  static async sendInitialStatus(bot, chatId, job) {
    const text = this.formatStatusText(job, JobStatus.QUEUED, 0);
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{
          text: isStealthMode() ? '[STOP] 작업 중단 (/stop)' : '🛑 작업 중단 (/stop)',
          callback_data: `job_cancel_session:${job.sessionId}`
        }]]
      }
    };
    return await bot.sendMessage(chatId, text, options);
  }

  static async updateStatus(bot, chatId, messageId, job, currentStatus, elapsedSec = 0) {
    try {
      if (currentStatus === JobStatus.COMPLETED) {
        await bot.deleteMessage(chatId, messageId);
        return;
      }
      const text = this.formatStatusText(job, currentStatus, elapsedSec);
      const isTerminal = currentStatus === JobStatus.FAILED || currentStatus === JobStatus.CANCELLED || currentStatus === JobStatus.INTERRUPTED;
      const replyMarkup = isTerminal ? { inline_keyboard: [] } : { inline_keyboard: [[{
        text: isStealthMode() ? '[STOP] 작업 중단 (/stop)' : '🛑 작업 중단 (/stop)',
        callback_data: `job_cancel_session:${job.sessionId}`
      }]] };
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup });
    } catch {}
  }

  static formatStatusText(job, status, elapsedSec) {
    const providerName = (job.provider || 'codex').toUpperCase();
    const modelName = job.model || 'Default';
    const stealth = isStealthMode();
    let icon = stealth ? '[WAIT]' : '⏳';
    let statusLabel = '대기 중 (QUEUED)';
    if (status === JobStatus.RUNNING) { icon = stealth ? '[RUN]' : '⚡'; statusLabel = `실행 중 (RUNNING, ${elapsedSec}s)`; }
    else if (status === JobStatus.COMPLETED) { icon = stealth ? '[OK]' : '✅'; statusLabel = `완료됨 (${elapsedSec}s)`; }
    else if (status === JobStatus.CANCELLED) { icon = stealth ? '[STOP]' : '🛑'; statusLabel = '사용자에 의해 취소됨 (CANCELLED)'; }
    else if (status === JobStatus.FAILED) { icon = stealth ? '[ERR]' : '❌'; statusLabel = '실행 실패 (FAILED)'; }
    else if (status === JobStatus.INTERRUPTED) { icon = stealth ? '[WARN]' : '⚠️'; statusLabel = '서버 재시작으로 중단됨 (INTERRUPTED)'; }
    return `${icon} **[${providerName} / ${modelName}]** ${statusLabel}\n_세션: ${job.sessionTitle || '활성 세션'}_`;
  }
}

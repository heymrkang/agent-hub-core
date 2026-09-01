import { JobStatus } from '../../jobs/types.js';
import { isStealthMode } from './ui-theme.js';
import { safeErrorMessage } from '../transport.js';

const DEFAULT_STATUS_UPDATE_INTERVAL_MS = 15000;

export class JobStatusRenderer {
  static lastUpdateAt = new Map();
  static updateIntervalMs = Math.max(5000, Number(process.env.TELEGRAM_STATUS_UPDATE_INTERVAL_MS || DEFAULT_STATUS_UPDATE_INTERVAL_MS));

  static key(chatId, messageId) { return `${chatId}:${messageId}`; }

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
    const message = await bot.sendMessage(chatId, text, options);
    if (message?.message_id) this.lastUpdateAt.set(this.key(chatId, message.message_id), Date.now());
    return message;
  }

  static async updateStatus(bot, chatId, messageId, job, currentStatus, elapsedSec = 0) {
    const key = this.key(chatId, messageId);
    const isTerminal = currentStatus === JobStatus.COMPLETED || currentStatus === JobStatus.FAILED || currentStatus === JobStatus.CANCELLED || currentStatus === JobStatus.INTERRUPTED;
    if (!isTerminal && currentStatus === JobStatus.RUNNING) {
      const lastAt = this.lastUpdateAt.get(key) || 0;
      if (Date.now() - lastAt < this.updateIntervalMs) return false;
      this.lastUpdateAt.set(key, Date.now());
    }

    try {
      if (currentStatus === JobStatus.COMPLETED) {
        await bot.deleteMessage(chatId, messageId);
        this.lastUpdateAt.delete(key);
        return true;
      }
      const text = this.formatStatusText(job, currentStatus, elapsedSec);
      const replyMarkup = isTerminal ? { inline_keyboard: [] } : { inline_keyboard: [[{
        text: isStealthMode() ? '[STOP] 작업 중단 (/stop)' : '🛑 작업 중단 (/stop)',
        callback_data: `job_cancel_session:${job.sessionId}`
      }]] };
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup });
      if (isTerminal) this.lastUpdateAt.delete(key);
      return true;
    } catch (error) {
      const transport = bot.__telegramTransport;
      if (isTerminal && transport?.isRateLimitedError(error)) {
        if (currentStatus === JobStatus.COMPLETED) {
          transport.defer(`job-status:${key}`, () => bot.deleteMessage(chatId, messageId));
        } else {
          const text = this.formatStatusText(job, currentStatus, elapsedSec);
          const options = { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } };
          transport.defer(`job-status:${key}`, () => bot.editMessageText(text, options));
        }
      } else if (isTerminal) {
        console.warn(`[JobStatusRenderer] terminal 상태 전달 실패: ${safeErrorMessage(error)}`);
      }
      if (isTerminal) this.lastUpdateAt.delete(key);
      return false;
    }
  }

  static formatStatusText(job, status, elapsedSec) {
    const providerName = (job.provider || 'codex').toUpperCase();
    const modelName = job.model || 'Default';
    const thinking = job.reasoningEffort || 'default';
    const stealth = isStealthMode();
    let icon = stealth ? '[WAIT]' : '⏳';
    let statusLabel = '대기 중 (QUEUED)';
    if (status === JobStatus.RUNNING) { icon = stealth ? '[RUN]' : '⚡'; statusLabel = `실행 중 (RUNNING, ${elapsedSec}s)`; }
    else if (status === JobStatus.COMPLETED) { icon = stealth ? '[OK]' : '✅'; statusLabel = `완료됨 (${elapsedSec}s)`; }
    else if (status === JobStatus.CANCELLED) { icon = stealth ? '[STOP]' : '🛑'; statusLabel = '사용자에 의해 취소됨 (CANCELLED)'; }
    else if (status === JobStatus.FAILED) { icon = stealth ? '[ERR]' : '❌'; statusLabel = '실행 실패 (FAILED)'; }
    else if (status === JobStatus.INTERRUPTED) { icon = stealth ? '[WARN]' : '⚠️'; statusLabel = '서버 재시작으로 중단됨 (INTERRUPTED)'; }
    return `${icon} **[${providerName} / ${modelName} / Thinking: ${thinking}]** ${statusLabel}\n_세션: ${job.sessionTitle || '활성 세션'}_`;
  }
}

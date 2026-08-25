import { JobStatus } from '../../jobs/types.js';

export class JobStatusRenderer {
  /**
   * 텔레그램 상태 표시 메시지를 발송한다.
   * @param {import('node-telegram-bot-api')} bot
   * @param {number} chatId
   * @param {object} job
   * @returns {Promise<object>} Telegram Message 객체
   */
  static async sendInitialStatus(bot, chatId, job) {
    const text = this.formatStatusText(job, JobStatus.QUEUED, 0);
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛑 작업 중단 (/stop)', callback_data: `job_cancel_session:${job.sessionId}` }]
        ]
      }
    };
    return await bot.sendMessage(chatId, text, options);
  }

  /**
   * 상태 메시지를 실시간 갱신한다.
   * @param {import('node-telegram-bot-api')} bot
   * @param {number} chatId
   * @param {number} messageId
   * @param {object} job
   * @param {string} currentStatus
   * @param {number} elapsedSec
   */
  static async updateStatus(bot, chatId, messageId, job, currentStatus, elapsedSec = 0) {
    try {
      const text = this.formatStatusText(job, currentStatus, elapsedSec);
      const isTerminal =
        currentStatus === JobStatus.COMPLETED ||
        currentStatus === JobStatus.FAILED ||
        currentStatus === JobStatus.CANCELLED ||
        currentStatus === JobStatus.INTERRUPTED;

      const replyMarkup = isTerminal
        ? { inline_keyboard: [] }
        : {
            inline_keyboard: [
              [{ text: '🛑 작업 중단 (/stop)', callback_data: `job_cancel_session:${job.sessionId}` }]
            ]
          };

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch {
      // 텔레그램 메시지 내용 동일 등의 에러 무시
    }
  }

  /**
   * 상태별 메시지 텍스트를 구성한다.
   */
  static formatStatusText(job, status, elapsedSec) {
    const providerName = (job.provider || 'codex').toUpperCase();
    const modelName = job.model || 'Default';

    let icon = '⏳';
    let statusLabel = '대기 중 (QUEUED)';

    if (status === JobStatus.RUNNING) {
      icon = '⚡';
      statusLabel = `실행 중 (RUNNING, ${elapsedSec}s)`;
    } else if (status === JobStatus.COMPLETED) {
      icon = '✅';
      statusLabel = `완료됨 (${elapsedSec}s)`;
    } else if (status === JobStatus.CANCELLED) {
      icon = '🛑';
      statusLabel = '사용자에 의해 취소됨 (CANCELLED)';
    } else if (status === JobStatus.FAILED) {
      icon = '❌';
      statusLabel = '실행 실패 (FAILED)';
    } else if (status === JobStatus.INTERRUPTED) {
      icon = '⚠️';
      statusLabel = '서버 재시작으로 중단됨 (INTERRUPTED)';
    }

    return `${icon} **[${providerName} / ${modelName}]** ${statusLabel}\n_세션: ${job.sessionTitle || '활성 세션'}_`;
  }
}

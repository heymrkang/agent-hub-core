import TelegramBot from 'node-telegram-bot-api';
import { isAuthorizedUser } from './telegram/auth.js';
import { SessionManager } from './sessions/session-manager.js';
import { TitleService } from './sessions/title-service.js';
import { queueManager } from './jobs/queue-manager.js';
import { JobStatusRenderer } from './telegram/renderer/job-status.js';
import { splitMessage } from './telegram/renderer/response-renderer.js';
import { handleNewCommand } from './telegram/commands/new.js';
import { handleRenameCommand } from './telegram/commands/rename.js';
import { handleSessionsCommand, handleSessionsCallback } from './telegram/commands/sessions.js';
import { handleModelCommand, handleModelCallback } from './telegram/commands/model.js';
import { handleProvidersCommand, handleProvidersCallback } from './telegram/commands/providers.js';
import { handleStopCommand, handleJobCancelCallback } from './telegram/commands/stop.js';
import { handleQueueCommand } from './telegram/commands/queue.js';

export function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  }

  const bot = new TelegramBot(token, { polling: true });

  // 1. 일반 메시지 및 커맨드 핸들러
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text?.trim();

    if (!text) return;

    // 단일 소유자 인증 검증
    if (!isAuthorizedUser(from)) {
      return;
    }

    const userId = from.id;

    // 명령어 라우팅
    if (text === '/start' || text === '/help') {
      const activeSession = SessionManager.getActiveSession(userId);
      const modelDisplay = activeSession.active_model || '기본 모델';
      const helpText =
        `🤖 **Agent Hub Core V1**\n\n` +
        `⭐ **현재 활성 세션**: **${activeSession.title}**\n` +
        `🤖 **Provider**: \`${activeSession.active_provider}\` (Model: \`${modelDisplay}\`)\n\n` +
        `📌 **세션 관리 명령어**:\n` +
        `• \`/new\` : 새 세션 생성 및 즉시 활성화\n` +
        `• \`/sessions\` : 세션 목록, 전환, 보관, 복구\n` +
        `• \`/rename <새 제목>\` : 활성 세션 이름 변경\n\n` +
        `📌 **모델 및 작업 제어 명령어**:\n` +
        `• \`/model\` : 활성 세션의 Provider 및 Model 변경\n` +
        `• \`/providers\` : Provider 상태, CLI 버전, 인증 확인\n` +
        `• \`/stop\` : 활성 세션의 실행 중인 작업 즉시 중단\n` +
        `• \`/queue\` : 대기열 및 동시성 현황 조회\n` +
        `• \`/help\` : 도움말 보기\n\n` +
        `메시지를 입력하면 현재 활성 세션의 큐에 등록되어 순차적으로 작업이 실행됩니다.`;

      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
      return;
    }

    if (text === '/new') {
      await handleNewCommand(bot, msg);
      return;
    }

    if (text === '/sessions') {
      await handleSessionsCommand(bot, msg);
      return;
    }

    if (text.startsWith('/rename')) {
      const args = text.replace(/^\/rename\s*/, '');
      await handleRenameCommand(bot, msg, args);
      return;
    }

    if (text === '/model') {
      await handleModelCommand(bot, msg);
      return;
    }

    if (text === '/providers') {
      await handleProvidersCommand(bot, msg);
      return;
    }

    if (text === '/stop') {
      await handleStopCommand(bot, msg);
      return;
    }

    if (text === '/queue') {
      await handleQueueCommand(bot, msg);
      return;
    }

    // 일반 프롬프트 실행 (2단계 큐 시스템 연동)
    const activeSession = SessionManager.getActiveSession(userId);
    console.log(`[Telegram] 메시지 수신 [Session: ${activeSession.id} / ${activeSession.title}]: ${text}`);

    // 사용자 질문을 Canonical DB에 영속화
    SessionManager.saveMessage({
      sessionId: activeSession.id,
      role: 'user',
      text
    });

    let statusMsg = null;
    try {
      // 1. 초기 진행 상태 메시지 발송
      statusMsg = await JobStatusRenderer.sendInitialStatus(bot, chatId, {
        id: 'pending',
        sessionTitle: activeSession.title,
        provider: activeSession.active_provider,
        model: activeSession.active_model
      });

      // 2. QueueManager에 작업 큐잉 및 실행
      const response = await queueManager.enqueueJob({
        sessionId: activeSession.id,
        sessionTitle: activeSession.title,
        provider: activeSession.active_provider,
        model: activeSession.active_model,
        prompt: text,
        profile: activeSession.execution_profile,
        onStatusUpdate: (currentStatus, elapsedSec) => {
          if (statusMsg) {
            JobStatusRenderer.updateStatus(
              bot,
              chatId,
              statusMsg.message_id,
              {
                id: 'active',
                sessionTitle: activeSession.title,
                provider: activeSession.active_provider,
                model: activeSession.active_model
              },
              currentStatus,
              elapsedSec
            );
          }
        }
      });

      // 3. AI 답변을 Canonical DB에 원문 통째로 1건 저장
      SessionManager.saveMessage({
        sessionId: activeSession.id,
        role: 'assistant',
        text: response,
        provider: activeSession.active_provider,
        model: activeSession.active_model
      });

      // 4. 첫 대화 성공 시 1회 자동 제목 생성 시도
      TitleService.autoGenerateTitleIfEligible(activeSession.id, text, response).catch(() => {});

      // 5. 텔레그램에는 길이 제한 및 코드 블록 보존 안전 분할하여 전송
      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(async () => {
          // 마크다운 파싱 오류 발생 시 일반 텍스트로 안전 전송
          await bot.sendMessage(chatId, chunk);
        });
      }
    } catch (err) {
      console.error(`[Job Error] ${err.message}`);
      if (statusMsg) {
        JobStatusRenderer.updateStatus(
          bot,
          chatId,
          statusMsg.message_id,
          {
            id: 'failed',
            sessionTitle: activeSession.title,
            provider: activeSession.active_provider,
            model: activeSession.active_model
          },
          'FAILED'
        );
      }
      await bot.sendMessage(chatId, `❌ 작업 실패:\n${err.message}`);
    }
  });

  // 2. 인라인 키보드 Callback Query 핸들러
  bot.on('callback_query', async (callbackQuery) => {
    if (!isAuthorizedUser(callbackQuery.from)) {
      return;
    }

    const data = callbackQuery.data;
    if (data.startsWith('session_')) {
      await handleSessionsCallback(bot, callbackQuery);
      return;
    }

    if (data.startsWith('model_')) {
      await handleModelCallback(bot, callbackQuery);
      return;
    }

    if (data.startsWith('providers_')) {
      await handleProvidersCallback(bot, callbackQuery);
      return;
    }

    if (data.startsWith('job_cancel:')) {
      await handleJobCancelCallback(bot, callbackQuery);
      return;
    }
  });

  bot.on('polling_error', (error) => {
    console.error(`[Telegram Polling Error] ${error.code}: ${error.message}`);
  });

  console.log('[Telegram] Bot Polling 시작 완료.');
  return bot;
}

import TelegramBot from 'node-telegram-bot-api';
import { isAuthorizedUser } from './telegram/auth.js';
import { SessionManager } from './sessions/session-manager.js';
import { TitleService } from './sessions/title-service.js';
import { ContextManager } from './context/context-manager.js';
import { AttachmentManager } from './attachments/attachment-manager.js';
import { mediaGroupBuffer } from './attachments/media-group-buffer.js';
import { MemoryManager } from './memory/memory-manager.js';
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
import { handleCompactCommand } from './telegram/commands/compact.js';
import { handleFilesCommand, handleDownloadCommand } from './telegram/commands/files.js';
import { handleMemoryCommand } from './telegram/commands/memory.js';

export function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  const bot = new TelegramBot(token, { polling: true });

  async function processPromptJob(chatId, userId, userText, attachedFiles = []) {
    const activeSession = SessionManager.getActiveSession(userId);

    // Canonical source of truth에 현재 사용자 turn을 먼저 기록한다.
    const canonicalUserText = userText || `[첨부 파일 ${attachedFiles.length}건 전송]`;
    const userMessageId = SessionManager.saveMessage({ sessionId: activeSession.id, role: 'user', text: canonicalUserText });

    const memoryBlock = MemoryManager.getMemoryForPrompt();
    let promptWithAttachments = userText;
    if (attachedFiles.length > 0) {
      const fileListStr = attachedFiles.map((f) => `- [${f.file_type}] ${f.file_name} (저장 경로: ${f.local_path})`).join('\n');
      promptWithAttachments = `[첨부 파일 목록]\n${fileListStr}\n\n[사용자 지시사항]\n${userText || '첨부된 파일을 확인하고 분석해주세요.'}`;
    }

    const contextPackage = ContextManager.buildContextPackage(activeSession.id);
    const historyMessages = contextPackage.messages.filter((m) => m.id !== userMessageId).slice(-10);
    const contextBlock = historyMessages.length
      ? `[이전 대화 기록 / Context]\n${historyMessages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n')}`
      : '';

    const promptParts = [];
    if (memoryBlock) promptParts.push(memoryBlock);
    if (contextPackage.rollingSummary) promptParts.push(`[대화 요약]\n${contextPackage.rollingSummary}`);
    if (contextBlock) promptParts.push(contextBlock);
    promptParts.push(promptWithAttachments || canonicalUserText);
    const finalPrompt = promptParts.join('\n\n');

    console.log(`[Telegram] 작업 실행 [Session: ${activeSession.id} / ${activeSession.title} / ${activeSession.active_provider}]: ${canonicalUserText}`);

    let statusMsg = null;
    try {
      statusMsg = await JobStatusRenderer.sendInitialStatus(bot, chatId, { sessionId: activeSession.id, sessionTitle: activeSession.title, provider: activeSession.active_provider, model: activeSession.active_model });
      const response = await queueManager.enqueueJob({
        sessionId: activeSession.id,
        sessionTitle: activeSession.title,
        provider: activeSession.active_provider,
        model: activeSession.active_model,
        prompt: finalPrompt,
        profile: activeSession.execution_profile,
        onStatusUpdate: (currentStatus, elapsedSec) => {
          if (statusMsg) JobStatusRenderer.updateStatus(bot, chatId, statusMsg.message_id, { sessionId: activeSession.id, sessionTitle: activeSession.title, provider: activeSession.active_provider, model: activeSession.active_model }, currentStatus, elapsedSec);
        }
      });

      SessionManager.saveMessage({ sessionId: activeSession.id, role: 'assistant', text: response, provider: activeSession.active_provider, model: activeSession.active_model });
      TitleService.autoGenerateTitleIfEligible(activeSession.id, userText || '첨부 파일 대화', response).catch(() => {});
      for (const chunk of splitMessage(response)) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(async () => bot.sendMessage(chatId, chunk));
      }
    } catch (err) {
      console.error(`[Job Error] ${err.message}`);
      if (statusMsg) JobStatusRenderer.updateStatus(bot, chatId, statusMsg.message_id, { sessionId: activeSession.id, sessionTitle: activeSession.title, provider: activeSession.active_provider, model: activeSession.active_model }, 'FAILED');
      await bot.sendMessage(chatId, `❌ 작업 실패:\n${err.message}`);
    }
  }

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text?.trim();
    if (!isAuthorizedUser(from) || !text) return;
    const userId = from.id;

    if (text === '/start' || text === '/help') {
      const activeSession = SessionManager.getActiveSession(userId);
      const modelDisplay = activeSession.active_model || '기본 모델';
      const helpText = `🤖 **Agent Hub Core V1**\n\n⭐ **현재 활성 세션**: **${activeSession.title}**\n🤖 **Provider**: \`${activeSession.active_provider}\` (Model: \`${modelDisplay}\`)\n\n📌 **세션 관리**:\n• \`/new\` : 새 세션 생성 및 즉시 활성화\n• \`/sessions\` : 세션 목록, 전환, 보관, 복구\n• \`/rename <새 제목>\` : 활성 세션 이름 변경\n\n📌 **모델 및 파일 관리**:\n• \`/model\` : Provider 및 Model 변경 (동적 디스커버리)\n• \`/providers\` : Provider 상태, CLI 버전, 인증 확인\n• \`/files\` : 세션 첨부 파일 목록 조회\n• \`/download <파일명>\` : 워크스페이스 파일 다운로드\n• \`/stop\` : 실행 중인 작업 즉시 중단\n• \`/queue\` : 대기열 및 동시성 현황 조회\n• \`/compact\` : 컨텍스트 압축 요청\n\n메시지나 사진/문서를 보내면 AI 에이전트가 작업을 수행합니다.`;
      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' }); return;
    }
    if (text === '/new') { await handleNewCommand(bot, msg); return; }
    if (text === '/sessions') { await handleSessionsCommand(bot, msg); return; }
    if (text.startsWith('/rename')) { await handleRenameCommand(bot, msg, text.replace(/^\/rename\s*/, '')); return; }
    if (text === '/model') { await handleModelCommand(bot, msg); return; }
    if (text === '/providers') { await handleProvidersCommand(bot, msg); return; }
    if (text === '/stop') { await handleStopCommand(bot, msg); return; }
    if (text === '/queue') { await handleQueueCommand(bot, msg); return; }
    if (text === '/compact') { await handleCompactCommand(bot, msg); return; }
    if (text === '/files') { await handleFilesCommand(bot, msg); return; }
    if (text.startsWith('/download')) { await handleDownloadCommand(bot, msg, text.replace(/^\/download\s*/, '')); return; }
    if (text.startsWith('/memory')) { await handleMemoryCommand(bot, msg, text.replace(/^\/memory\s*/, '')); return; }
    await processPromptJob(chatId, userId, text, []);
  });

  bot.on('photo', async (msg) => {
    if (!isAuthorizedUser(msg.from)) return;
    const chatId = msg.chat.id; const userId = msg.from.id; const activeSession = SessionManager.getActiveSession(userId);
    try {
      const photo = msg.photo[msg.photo.length - 1];
      const attachment = await AttachmentManager.saveTelegramFile(bot, photo.file_id, { sessionId: activeSession.id, mediaGroupId: msg.media_group_id, fileName: `photo_${photo.file_unique_id}.jpg`, fileType: 'IMAGE', mimeType: 'image/jpeg', fileSize: photo.file_size });
      if (msg.media_group_id) mediaGroupBuffer.add(msg.media_group_id, { msg, attachment }, async (items, combinedCaption) => processPromptJob(chatId, userId, combinedCaption, items.map((i) => i.attachment)));
      else await processPromptJob(chatId, userId, msg.caption || '', [attachment]);
    } catch (err) { console.error(`[Photo Upload Error] ${err.message}`); await bot.sendMessage(chatId, `❌ 사진 다운로드/처리 실패: ${err.message}`); }
  });

  bot.on('document', async (msg) => {
    if (!isAuthorizedUser(msg.from)) return;
    const chatId = msg.chat.id; const userId = msg.from.id; const activeSession = SessionManager.getActiveSession(userId);
    try {
      const doc = msg.document;
      const attachment = await AttachmentManager.saveTelegramFile(bot, doc.file_id, { sessionId: activeSession.id, mediaGroupId: msg.media_group_id, fileName: doc.file_name || `doc_${doc.file_unique_id}`, fileType: 'DOCUMENT', mimeType: doc.mime_type, fileSize: doc.file_size });
      if (msg.media_group_id) mediaGroupBuffer.add(msg.media_group_id, { msg, attachment }, async (items, combinedCaption) => processPromptJob(chatId, userId, combinedCaption, items.map((i) => i.attachment)));
      else await processPromptJob(chatId, userId, msg.caption || '', [attachment]);
    } catch (err) { console.error(`[Document Upload Error] ${err.message}`); await bot.sendMessage(chatId, `❌ 문서 다운로드/처리 실패: ${err.message}`); }
  });

  bot.on('callback_query', async (callbackQuery) => {
    if (!isAuthorizedUser(callbackQuery.from)) return;
    const data = callbackQuery.data;
    if (data.startsWith('session_')) { await handleSessionsCallback(bot, callbackQuery); return; }
    if (data.startsWith('model_')) { await handleModelCallback(bot, callbackQuery); return; }
    if (data.startsWith('providers_')) { await handleProvidersCallback(bot, callbackQuery); return; }
    if (data.startsWith('job_cancel')) { await handleJobCancelCallback(bot, callbackQuery); return; }
  });

  bot.on('polling_error', (error) => console.error(`[Telegram Polling Error] ${error.code}: ${error.message}`));
  console.log('[Telegram] Bot Polling 시작 완료.');
  return bot;
}

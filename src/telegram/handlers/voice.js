import { isWhisperAvailable, transcribeAudio } from '../../utils/stt.js';
import { isStealthMode } from '../renderer/ui-theme.js';
import { safeErrorMessage } from '../transport.js';

export async function handleVoiceMessage({ bot, msg, processPromptJob }) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Check Whisper Availability (Graceful Fallback - 절대 안 뻗음)
  if (!isWhisperAvailable()) {
    const icon = isStealthMode() ? '!' : '⚠️';
    const warning = `${icon} **OpenAI API Key가 설정되지 않았습니다.**\n\n음성 메시지를 텍스트 프롬프트로 변환하려면 호스트 환경변수에 \`OPENAI_API_KEY\`를 등록해주세요.`;
    await bot.sendMessage(chatId, warning, { parse_mode: 'Markdown' });
    return;
  }

  const voiceObj = msg.voice || msg.audio;
  if (!voiceObj || !voiceObj.file_id) {
    return;
  }

  let processingMsg = null;
  try {
    processingMsg = await bot.sendMessage(
      chatId,
      `🎙️ _음성 인식 중..._`,
      { parse_mode: 'Markdown' }
    );

    // 2. Telegram 파일 다운로드 (메모리 버퍼로 바로 수신)
    const fileLink = await bot.getFileLink(voiceObj.file_id);
    const res = await fetch(fileLink);
    if (!res.ok) {
      throw new Error(`Telegram 파일 다운로드 실패 (HTTP ${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 3. Whisper STT 변환
    const transcribedText = await transcribeAudio(audioBuffer, {
      filename: msg.voice ? 'voice.oga' : (msg.audio?.file_name || 'audio.mp3')
    });

    if (!transcribedText || !transcribedText.trim()) {
      if (processingMsg?.message_id) {
        await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
      }
      await bot.sendMessage(chatId, `⚠️ 음성에서 텍스트를 인식하지 못했습니다.`);
      return;
    }

    // 4. 인식 결과 피드백 (진행 메시지를 결과 메시지로 갱신)
    if (processingMsg?.message_id) {
      await bot.editMessageText(
        `🎙️ **음성 인식**: "${transcribedText}"`,
        {
          chat_id: chatId,
          message_id: processingMsg.message_id,
          parse_mode: 'Markdown'
        }
      ).catch(() => {});
    } else {
      await bot.sendMessage(
        chatId,
        `🎙️ **음성 인식**: "${transcribedText}"`,
        { parse_mode: 'Markdown' }
      );
    }

    // 5. 프롬프트 작업 큐에 즉시 인입
    await processPromptJob(chatId, userId, transcribedText, []);
  } catch (err) {
    console.error(`[Voice STT Error] ${safeErrorMessage(err)}`);
    if (processingMsg?.message_id) {
      await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
    }
    await bot.sendMessage(
      chatId,
      `${isStealthMode() ? '×' : '❌'} 음성 변환 실패: ${safeErrorMessage(err)}`
    );
  }
}

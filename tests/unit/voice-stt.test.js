import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWhisperAvailable,
  transcribeAudio,
  DEV_PROMPT_HINT
} from '../../src/utils/stt.js';
import { handleVoiceMessage } from '../../src/telegram/handlers/voice.js';

test('isWhisperAvailable detects presence of OPENAI_API_KEY', () => {
  assert.equal(isWhisperAvailable(''), false);
  assert.equal(isWhisperAvailable('   '), false);
  assert.equal(isWhisperAvailable(null), false);
  assert.equal(isWhisperAvailable('sk-test-key-123'), true);
});

test('transcribeAudio validates key and sends whisper request', async () => {
  // 1. 키 미설정 에러
  await assert.rejects(
    () => transcribeAudio(Buffer.from('fake-audio'), { apiKey: '' }),
    /OpenAI API Key가 설정되지 않았습니다/
  );

  // 2. 정상 Whisper 호출 Mock
  let calledUrl = null;
  let calledHeaders = null;
  let calledBody = null;

  const mockFetch = async (url, options) => {
    calledUrl = url;
    calledHeaders = options.headers;
    calledBody = options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: 'Next.js 블로그 배포해줘' })
    };
  };

  const text = await transcribeAudio(Buffer.from('mock-audio-bytes'), {
    apiKey: 'sk-test-1234',
    fetch: mockFetch
  });

  assert.equal(text, 'Next.js 블로그 배포해줘');
  assert.equal(calledUrl, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calledHeaders.Authorization, 'Bearer sk-test-1234');
  assert.ok(calledBody instanceof FormData);
  assert.equal(calledBody.get('model'), 'whisper-1');
  assert.equal(calledBody.get('prompt'), DEV_PROMPT_HINT);

  // 3. API HTTP 에러 대응
  const failFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Invalid API key'
  });

  await assert.rejects(
    () => transcribeAudio(Buffer.from('mock'), { apiKey: 'bad-key', fetch: failFetch }),
    /Whisper API 오류 \(HTTP 401\)/
  );
});

test('handleVoiceMessage handles missing key gracefully without crashing', async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  });

  const sentMessages = [];
  const mockBot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: 1 };
    }
  };

  let promptJobCalled = false;
  const mockProcessPrompt = async () => {
    promptJobCalled = true;
  };

  const msg = {
    chat: { id: 112233 },
    from: { id: 445566 },
    voice: { file_id: 'voice_file_123' }
  };

  await handleVoiceMessage({
    bot: mockBot,
    msg,
    processPromptJob: mockProcessPrompt
  });

  // 키 미등록 시 친절한 안내 메시지 전송 확인
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 112233);
  assert.match(sentMessages[0].text, /OpenAI API Key가 설정되지 않았습니다/);

  // 작업 큐는 호출되지 않아야 함 (안전한 종료)
  assert.equal(promptJobCalled, false);
});

test('handleVoiceMessage transcribes voice and enqueues prompt job', async (t) => {
  process.env.OPENAI_API_KEY = 'sk-mock-valid-key';

  const originalFetch = globalThis.fetch;
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  });

  // Mock global fetch:
  // 1. Telegram file download -> return dummy audio buffer
  // 2. Whisper transcription -> return text
  globalThis.fetch = async (url) => {
    if (String(url).includes('telegram.org')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
      };
    }
    if (String(url).includes('openai.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: '리팩토링 시작해줘' })
      };
    }
    return { ok: false, status: 404 };
  };

  const sentMessages = [];
  const editedMessages = [];
  const mockBot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: 10 + sentMessages.length };
    },
    async editMessageText(text, options) {
      editedMessages.push({ text, options });
      return true;
    },
    async getFileLink(fileId) {
      return `https://api.telegram.org/file/bot-token/${fileId}`;
    }
  };

  let receivedPrompt = null;
  let receivedUserId = null;
  const mockProcessPrompt = async (chatId, userId, text, attachments) => {
    receivedPrompt = text;
    receivedUserId = userId;
  };

  const msg = {
    chat: { id: 778899 },
    from: { id: 998877 },
    voice: { file_id: 'voice_file_abc' }
  };

  await handleVoiceMessage({
    bot: mockBot,
    msg,
    processPromptJob: mockProcessPrompt
  });

  // 진행 메시지 및 결과 편집 확인
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /음성 인식 중/);
  assert.equal(editedMessages.length, 1);
  assert.match(editedMessages[0].text, /리팩토링 시작해줘/);

  // 작업 큐에 정상적으로 텍스트 프롬프트 인입 확인
  assert.equal(receivedPrompt, '리팩토링 시작해줘');
  assert.equal(receivedUserId, 998877);
});

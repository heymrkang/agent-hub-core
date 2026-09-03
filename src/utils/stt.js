export const DEV_PROMPT_HINT =
  'React, Next.js, Node.js, NestJS, Prisma, MariaDB, Docker, Git, API, Swagger, OpenAPI, TypeScript, 리팩토링, 배포, 핫픽스, 쿼리, 인덱스, 버그, 커밋, 푸시';

export function isWhisperAvailable(apiKey = null) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  return Boolean(key?.trim());
}

export async function transcribeAudio(audioBuffer, options = {}) {
  const apiKey = (options.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OpenAI API Key가 설정되지 않았습니다.');
  }

  const filename = options.filename || 'voice.oga';
  const language = options.language || 'ko';
  const prompt = options.prompt || DEV_PROMPT_HINT;

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), filename);
  form.append('model', 'whisper-1');
  form.append('language', language);
  form.append('prompt', prompt);

  const fetchFn = options.fetch || globalThis.fetch;
  const res = await fetchFn('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Whisper API 오류 (HTTP ${res.status}): ${errorText}`);
  }

  const json = await res.json();
  return json.text?.trim() || '';
}

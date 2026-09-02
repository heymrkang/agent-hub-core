export class CodexExecJsonlParser {
  constructor({ expectedThreadId = null, requireThreadId = false } = {}) {
    this.expectedThreadId = expectedThreadId || null;
    this.requireThreadId = Boolean(requireThreadId);
    this.buffer = '';
    this.threadId = null;
    this.lastAgentMessage = '';
    this.usage = null;
    this.eventCount = 0;
  }

  push(chunk) {
    this.buffer += String(chunk ?? '');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) this.#consumeLine(line);
  }

  finish() {
    if (this.buffer.trim()) this.#consumeLine(this.buffer);
    this.buffer = '';

    if (this.requireThreadId && !this.threadId) {
      const error = new Error('Codex 새 native session 실행에서 thread.started.thread_id를 받지 못했습니다.');
      error.code = 'CODEX_NATIVE_THREAD_ID_MISSING';
      throw error;
    }

    if (this.expectedThreadId && this.threadId && this.threadId !== this.expectedThreadId) {
      const error = new Error(`Codex resume thread 불일치: expected=${this.expectedThreadId}, actual=${this.threadId}`);
      error.code = 'CODEX_NATIVE_THREAD_MISMATCH';
      throw error;
    }

    return {
      response: this.lastAgentMessage,
      nativeSessionRef: this.threadId || this.expectedThreadId || null,
      usage: this.usage,
      eventCount: this.eventCount
    };
  }

  #consumeLine(rawLine) {
    const line = String(rawLine || '').trim();
    if (!line) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch (cause) {
      const error = new Error(`Codex JSONL 파싱 실패: ${cause.message}`);
      error.code = 'CODEX_JSONL_PARSE_ERROR';
      error.cause = cause;
      throw error;
    }

    this.eventCount += 1;

    if (event?.type === 'thread.started' && event.thread_id) {
      const threadId = String(event.thread_id).trim();
      if (this.threadId && this.threadId !== threadId) {
        const error = new Error(`한 Codex 실행에서 서로 다른 thread_id가 감지되었습니다: ${this.threadId} -> ${threadId}`);
        error.code = 'CODEX_NATIVE_THREAD_MISMATCH';
        throw error;
      }
      this.threadId = threadId;
      return;
    }

    if (event?.type === 'item.completed' && event?.item?.type === 'agent_message') {
      this.lastAgentMessage = String(event.item.text ?? '');
      return;
    }

    if (event?.type === 'turn.completed' && event.usage) {
      this.usage = event.usage;
    }
  }
}

export function parseCodexExecJsonl(value, options = {}) {
  const parser = new CodexExecJsonlParser(options);
  parser.push(String(value ?? ''));
  return parser.finish();
}

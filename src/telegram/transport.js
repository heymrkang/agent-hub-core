import { redactSecrets } from '../utils/redact.js';

const DEFAULT_RETRY_DELAYS_MS = [300, 900];
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE']);
const MARKDOWN_PARSE_RE = /can't parse entities|can't find end of the entity|unsupported start tag|wrong entity|parse entities/i;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class TelegramDeliveryError extends Error {
  constructor(message, { method, category = 'UNKNOWN', statusCode = null, retryAfter = null, originalCode = null } = {}) {
    super(message);
    this.name = 'TelegramDeliveryError';
    this.code = 'TELEGRAM_DELIVERY';
    this.method = method;
    this.category = category;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
    this.originalCode = originalCode;
  }
}

export function inspectTelegramError(error, method = 'telegram') {
  const statusCode = Number(error?.response?.statusCode || error?.response?.body?.error_code || 0) || null;
  const description = redactSecrets(error?.response?.body?.description || error?.message || String(error || 'Telegram error'));
  const headerRetry = error?.response?.headers?.['retry-after'] ?? error?.response?.headers?.['Retry-After'];
  const bodyRetry = error?.response?.body?.parameters?.retry_after;
  const matchRetry = description.match(/retry after\s+(\d+)/i)?.[1];
  const retryAfter = Number(bodyRetry ?? headerRetry ?? matchRetry ?? 0) || null;
  const originalCode = error?.code || null;
  let category = 'UNKNOWN';
  if (statusCode === 429) category = 'RATE_LIMIT';
  else if (statusCode === 403) category = 'FORBIDDEN';
  else if (statusCode === 400 && MARKDOWN_PARSE_RE.test(description)) category = 'PARSE';
  else if ((statusCode && statusCode >= 500) || TRANSIENT_CODES.has(originalCode)) category = 'TRANSIENT';
  else if (statusCode && statusCode >= 400) category = 'HTTP';
  return { method, statusCode, description, retryAfter, originalCode, category };
}

export function safeErrorMessage(error) {
  if (error instanceof TelegramDeliveryError) return redactSecrets(error.message);
  if (error?.response?.body?.error_code || error?.response?.statusCode) {
    const info = inspectTelegramError(error);
    return `Telegram ${info.category}${info.statusCode ? ` ${info.statusCode}` : ''}${info.retryAfter ? ` retry_after=${info.retryAfter}s` : ''}: ${info.description}`;
  }
  return redactSecrets(error?.message || String(error));
}

function stripMarkdown(text) {
  return String(text ?? '').replace(/[*_`\[]/g, '');
}

function sanitizedError(info) {
  const suffix = info.retryAfter ? ` (retry_after=${info.retryAfter}s)` : '';
  return new TelegramDeliveryError(`Telegram ${info.method} 실패: ${info.description}${suffix}`, info);
}

export class TelegramTransport {
  constructor(bot, { now = () => Date.now(), sleepFn = sleep, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
    this.bot = bot;
    this.now = now;
    this.sleepFn = sleepFn;
    this.retryDelaysMs = retryDelaysMs;
    this.cooldownUntil = 0;
    this.deferred = new Map();
    this.flushTimer = null;
    this.raw = {
      sendMessage: bot.sendMessage.bind(bot),
      editMessageText: bot.editMessageText.bind(bot),
      deleteMessage: bot.deleteMessage.bind(bot),
      deleteMessages: typeof bot.deleteMessages === 'function' ? bot.deleteMessages.bind(bot) : null,
      answerCallbackQuery: bot.answerCallbackQuery.bind(bot)
    };
  }

  install() {
    this.bot.sendMessage = (...args) => this.call('sendMessage', args, { markdownFallback: true });
    this.bot.editMessageText = (...args) => this.call('editMessageText', args, { markdownFallback: true });
    this.bot.deleteMessage = (...args) => this.call('deleteMessage', args);
    if (this.raw.deleteMessages) this.bot.deleteMessages = (...args) => this.call('deleteMessages', args);
    this.bot.answerCallbackQuery = (...args) => this.call('answerCallbackQuery', args);
    Object.defineProperty(this.bot, '__telegramTransport', { value: this, configurable: false, enumerable: false });
    return this.bot;
  }

  isRateLimitedError(error) { return error instanceof TelegramDeliveryError && error.category === 'RATE_LIMIT'; }
  isCoolingDown() { return this.cooldownUntil > this.now(); }
  remainingCooldownSeconds() { return Math.max(0, Math.ceil((this.cooldownUntil - this.now()) / 1000)); }

  setCooldown(seconds) {
    const safeSeconds = Math.max(1, Number(seconds) || 1);
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + safeSeconds * 1000);
    console.warn(`[TelegramTransport] RATE_LIMIT cooldown=${safeSeconds}s`);
    this.scheduleDeferredFlush();
  }

  cooldownError(method) {
    const retryAfter = this.remainingCooldownSeconds();
    return new TelegramDeliveryError(`Telegram ${method} 보류: rate-limit cooldown ${retryAfter}s`, {
      method, category: 'RATE_LIMIT', statusCode: 429, retryAfter
    });
  }

  async call(method, args, { markdownFallback = false } = {}) {
    if (this.isCoolingDown()) throw this.cooldownError(method);
    const fn = this.raw[method];
    if (!fn) throw new TelegramDeliveryError(`Telegram ${method} 미지원`, { method, category: 'UNSUPPORTED' });

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn(...args);
      } catch (error) {
        const info = inspectTelegramError(error, method);
        if (info.category === 'RATE_LIMIT') {
          this.setCooldown(info.retryAfter || 1);
          throw sanitizedError(info);
        }
        if (markdownFallback && info.category === 'PARSE') {
          try {
            return await fn(...this.toPlainArgs(method, args));
          } catch (fallbackError) {
            const fallbackInfo = inspectTelegramError(fallbackError, method);
            if (fallbackInfo.category === 'RATE_LIMIT') this.setCooldown(fallbackInfo.retryAfter || 1);
            throw sanitizedError(fallbackInfo);
          }
        }
        if (info.category === 'TRANSIENT' && attempt < this.retryDelaysMs.length) {
          await this.sleepFn(this.retryDelaysMs[attempt]);
          if (this.isCoolingDown()) throw this.cooldownError(method);
          continue;
        }
        throw sanitizedError(info);
      }
    }
  }

  toPlainArgs(method, args) {
    const next = [...args];
    if (method === 'sendMessage') {
      next[1] = stripMarkdown(next[1]);
      next[2] = { ...(next[2] || {}) };
      delete next[2].parse_mode;
    } else if (method === 'editMessageText') {
      next[0] = stripMarkdown(next[0]);
      next[1] = { ...(next[1] || {}) };
      delete next[1].parse_mode;
    }
    return next;
  }

  defer(key, operation) {
    if (!key || typeof operation !== 'function') return false;
    this.deferred.set(String(key), operation);
    this.scheduleDeferredFlush();
    return true;
  }

  scheduleDeferredFlush() {
    if (!this.deferred.size || this.flushTimer) return;
    const delay = Math.max(100, this.cooldownUntil - this.now() + 150);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushDeferred();
    }, delay);
    this.flushTimer.unref?.();
  }

  async flushDeferred() {
    if (this.isCoolingDown()) { this.scheduleDeferredFlush(); return; }
    for (const [key, operation] of Array.from(this.deferred.entries())) {
      try {
        await operation();
        this.deferred.delete(key);
        await this.sleepFn(120);
      } catch (error) {
        if (this.isRateLimitedError(error)) {
          this.scheduleDeferredFlush();
          return;
        }
        console.warn(`[TelegramTransport] deferred=${key} 폐기: ${safeErrorMessage(error)}`);
        this.deferred.delete(key);
      }
    }
    if (this.deferred.size) this.scheduleDeferredFlush();
  }
}

export function installTelegramTransport(bot, options = {}) {
  return new TelegramTransport(bot, options).install();
}

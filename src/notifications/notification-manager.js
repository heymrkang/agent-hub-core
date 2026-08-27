import { getSettingsManager } from '../settings/settings-manager.js';
import { redactSecrets } from '../utils/redact.js';

class NotificationManagerImpl {
  constructor() { this.bot = null; }
  init(bot) { this.bot = bot; }
  enabled() { try { return getSettingsManager().get('notifications_enabled'); } catch { return true; } }
  stealth() { try { return getSettingsManager().get('stealth_mode') === 'STEALTH'; } catch { return false; } }

  async send(userId, { normal, stealth = null, force = false, parseMode = 'Markdown' }) {
    if (!this.bot || !userId) return false;
    if (!force && !this.enabled()) return false;
    const isStealth = this.stealth();
    const text = redactSecrets(isStealth ? (stealth ?? normal.replace(/[✅❌⚠️⏰⏭️🔔🛠️]/g, '')) : normal);
    try {
      await this.bot.sendMessage(userId, text, isStealth || !parseMode ? {} : { parse_mode: parseMode });
      return true;
    } catch {
      await this.bot.sendMessage(userId, text.replace(/[*_`\[]/g, '')).catch(() => {});
      return false;
    }
  }

  async schedulerCompleted(userId, name, output) { return this.send(userId, { normal: `⏰ **예약 작업 완료**\n\n**${name}**\n\n${output.slice(0, 3500)}`, stealth: `예약 작업 완료\n\n${name}\n\n${output.slice(0, 3500)}` }); }
  async schedulerFailed(userId, name, error, skipped = false) { return this.send(userId, { normal: `${skipped ? '⏭️ **예약 작업 스킵됨**' : '❌ **예약 작업 실패**'}\n\n**${name}**\n${error}`, stealth: `${skipped ? '예약 작업 스킵됨' : '예약 작업 실패'}\n\n${name}\n${error}` }); }
  async systemFailure(userId, title, error) { return this.send(userId, { normal: `❌ **${title}**\n${error}`, stealth: `${title}\n${error}` }); }
}

export const NotificationManager = new NotificationManagerImpl();

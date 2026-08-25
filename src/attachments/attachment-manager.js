import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { getDb } from '../database/index.js';

export class AttachmentManager {
  static getBaseUploadDir() {
    const dataDir = process.env.DATA_DIR || '/data';
    const uploadDir = path.join(dataDir, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    return uploadDir;
  }

  static getMonthlyUploadDir() {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetDir = path.join(this.getBaseUploadDir(), yearMonth);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  }

  /**
   * Telegram으로부터 파일을 다운로드하고 SHA256 계산 후 영속 저장한다.
   * @param {import('node-telegram-bot-api')} bot
   * @param {string} fileId
   * @param {object} fileMeta { sessionId, messageId, mediaGroupId, fileName, fileType, mimeType, fileSize }
   * @returns {Promise<object>} 저장된 Attachment DB 레코드
   */
  static async saveTelegramFile(bot, fileId, fileMeta) {
    const fileLink = await bot.getFileLink(fileId);
    const targetDir = this.getMonthlyUploadDir();

    const fileExt = path.extname(fileMeta.fileName || '') || this.guessExtension(fileMeta.mimeType);
    const uniqueFileName = `${crypto.randomUUID()}${fileExt}`;
    const localPath = path.join(targetDir, uniqueFileName);

    // 파일 다운로드 및 SHA256 해시 스트림 계산
    const hash = crypto.createHash('sha256');
    const writeStream = fs.createWriteStream(localPath);

    await new Promise((resolve, reject) => {
      const client = fileLink.startsWith('https') ? https : http;
      client.get(fileLink, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Telegram 파일 다운로드 실패 (HTTP ${response.statusCode})`));
          return;
        }

        response.on('data', (chunk) => {
          hash.update(chunk);
        });

        response.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      }).on('error', reject);
    });

    const sha256 = hash.digest('hex');
    const stats = fs.statSync(localPath);
    const attachmentId = crypto.randomUUID();

    const db = getDb();
    db.prepare(`
      INSERT INTO attachments (
        id, session_id, message_id, media_group_id, file_name, file_type,
        mime_type, file_size, local_path, sha256, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      attachmentId,
      fileMeta.sessionId,
      fileMeta.messageId || null,
      fileMeta.mediaGroupId || null,
      fileMeta.fileName || uniqueFileName,
      fileMeta.fileType || 'DOCUMENT',
      fileMeta.mimeType || 'application/octet-stream',
      stats.size,
      localPath,
      sha256,
      JSON.stringify(fileMeta.metadata || {})
    );

    return this.getAttachment(attachmentId);
  }

  static getAttachment(attachmentId) {
    const db = getDb();
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) || null;
  }

  static getAttachmentsForSession(sessionId, limit = 20) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM attachments
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit);
  }

  static guessExtension(mimeType) {
    if (!mimeType) return '';
    if (mimeType.includes('image/png')) return '.png';
    if (mimeType.includes('image/jpeg')) return '.jpg';
    if (mimeType.includes('image/webp')) return '.webp';
    if (mimeType.includes('application/pdf')) return '.pdf';
    if (mimeType.includes('text/plain')) return '.txt';
    if (mimeType.includes('application/json')) return '.json';
    return '';
  }
}

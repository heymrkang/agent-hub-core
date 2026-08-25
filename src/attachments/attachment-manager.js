import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import sharp from 'sharp';
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
   * Telegram으로부터 파일을 다운로드하고, 이미지의 경우 WebP로 압축 변환 후 SHA256 계산 및 영속 저장한다.
   * @param {import('node-telegram-bot-api')} bot
   * @param {string} fileId
   * @param {object} fileMeta { sessionId, messageId, mediaGroupId, fileName, fileType, mimeType, fileSize }
   * @returns {Promise<object>} 저장된 Attachment DB 레코드
   */
  static async saveTelegramFile(bot, fileId, fileMeta) {
    const fileLink = await bot.getFileLink(fileId);
    const targetDir = this.getMonthlyUploadDir();

    const isImage = fileMeta.fileType === 'IMAGE' || fileMeta.mimeType?.startsWith('image/');
    const fileUuid = crypto.randomUUID();

    // 1. 임시 파일로 먼저 다운로드
    const tempPath = path.join(targetDir, `${fileUuid}.tmp`);
    const tempWriteStream = fs.createWriteStream(tempPath);

    await new Promise((resolve, reject) => {
      const client = fileLink.startsWith('https') ? https : http;
      client.get(fileLink, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Telegram 파일 다운로드 실패 (HTTP ${response.statusCode})`));
          return;
        }
        response.pipe(tempWriteStream);
        tempWriteStream.on('finish', resolve);
        tempWriteStream.on('error', reject);
      }).on('error', reject);
    });

    let finalLocalPath = '';
    let finalMimeType = fileMeta.mimeType || 'application/octet-stream';
    let finalFileName = fileMeta.fileName || `${fileUuid}.bin`;

    if (isImage) {
      // 2. 이미지는 sharp를 이용해 고효율 WebP로 압축 변환 (quality 75, 최대 가로 2048px)
      const webpFileName = `${fileUuid}.webp`;
      finalLocalPath = path.join(targetDir, webpFileName);
      finalMimeType = 'image/webp';
      finalFileName = fileMeta.fileName
        ? `${path.parse(fileMeta.fileName).name}.webp`
        : webpFileName;

      try {
        await sharp(tempPath)
          .resize({ width: 2048, withoutEnlargement: true })
          .webp({ quality: 75, effort: 4 })
          .toFile(finalLocalPath);

        // 임시 원본 파일 삭제
        fs.unlinkSync(tempPath);
      } catch (err) {
        console.warn(`[AttachmentManager] WebP 변환 실패, 원본 유지: ${err.message}`);
        finalLocalPath = path.join(targetDir, `${fileUuid}.jpg`);
        fs.renameSync(tempPath, finalLocalPath);
        finalMimeType = 'image/jpeg';
      }
    } else {
      // 3. 일반 문서는 원본 확장자로 저장
      const fileExt = path.extname(fileMeta.fileName || '') || this.guessExtension(fileMeta.mimeType);
      finalLocalPath = path.join(targetDir, `${fileUuid}${fileExt}`);
      fs.renameSync(tempPath, finalLocalPath);
    }

    // 4. 최종 저장 파일의 SHA256 및 용량 계산
    const fileBuffer = fs.readFileSync(finalLocalPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const finalSize = fileBuffer.length;
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
      finalFileName,
      fileMeta.fileType || (isImage ? 'IMAGE' : 'DOCUMENT'),
      finalMimeType,
      finalSize,
      finalLocalPath,
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

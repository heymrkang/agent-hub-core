import fs from 'fs';
import path from 'path';
import { AttachmentManager } from '../../attachments/attachment-manager.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { formatKST } from '../../utils/date.js';

/**
 * /files 명령어 처리: 현재 세션의 첨부 파일 목록 조회
 */
export async function handleFilesCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const attachments = AttachmentManager.getAttachmentsForSession(activeSession.id, 10);

    if (attachments.length === 0) {
      await bot.sendMessage(
        chatId,
        `📁 **[${activeSession.title}]** 세션에 등록된 첨부 파일이 없습니다.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let text = `📁 **[${activeSession.title}] 세션 첨부 파일 목록**\n\n`;
    for (const [idx, att] of attachments.entries()) {
      const sizeKb = Math.round(att.file_size / 1024);
      text += `${idx + 1}. \`${att.file_name}\` (${sizeKb} KB, ${att.file_type})\n`;
      text += `   - 경로: \`${att.local_path}\`\n`;
      text += `   - 일시: ${formatKST(att.created_at)}\n`;
    }

    text += `\n_파일을 다운로드하려면 \`/download <파일명>\` 명령어를 사용하세요._`;

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(async () => {
      await bot.sendMessage(chatId, text);
    });
  } catch (error) {
    console.error(`[Command /files Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 파일 목록 조회 실패: ${error.message}`);
  }
}

/**
 * /download <filename> 명령어 처리: 파일 전송 및 Path Traversal 방어
 */
export async function handleDownloadCommand(bot, msg, filename) {
  const chatId = msg.chat.id;
  const targetFile = filename?.trim();

  if (!targetFile) {
    await bot.sendMessage(chatId, '❌ 다운로드할 파일명을 지정해주세요.\n예: `/download result.py` 또는 `/download /workspace/output.txt`', {
      parse_mode: 'Markdown'
    });
    return;
  }

  // Path Traversal 방어
  if (targetFile.includes('..') || targetFile.includes('~')) {
    await bot.sendMessage(chatId, '❌ 보안 오류: 유효하지 않은 경로 탐색 패턴이 포함되어 있습니다.');
    return;
  }

  const workspaceDir = process.env.WORKSPACE_DIR || '/workspace';
  const dataDir = process.env.DATA_DIR || '/data';

  let resolvedPath = null;

  // 1. 전체 절대 경로로 전달된 경우
  if (path.isAbsolute(targetFile) && fs.existsSync(targetFile)) {
    resolvedPath = targetFile;
  }

  // 2. DB attachments 테이블에서 file_name 또는 local_path로 조회
  if (!resolvedPath) {
    try {
      const attachments = AttachmentManager.getAttachmentsForSession(
        SessionManager.getActiveSession(msg.from.id).id,
        50
      );
      const match = attachments.find(
        (a) => a.file_name === targetFile || a.id === targetFile || path.basename(a.local_path) === targetFile
      );
      if (match && fs.existsSync(match.local_path)) {
        resolvedPath = match.local_path;
      }
    } catch {}
  }

  // 3. workspace 디렉토리에서 검색
  if (!resolvedPath) {
    const candidateWorkspace = path.join(workspaceDir, targetFile);
    if (fs.existsSync(candidateWorkspace)) {
      resolvedPath = candidateWorkspace;
    }
  }

  // 4. /data/uploads 하위 폴더 재귀 검색
  if (!resolvedPath) {
    const uploadsDir = path.join(dataDir, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const findInDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findInDir(full);
            if (found) return found;
          } else if (entry.name === targetFile) {
            return full;
          }
        }
        return null;
      };
      resolvedPath = findInDir(uploadsDir);
    }
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    await bot.sendMessage(chatId, `❌ 파일을 찾을 수 없습니다: \`${targetFile}\``, {
      parse_mode: 'Markdown'
    });
    return;
  }

  try {
    const fileStats = fs.statSync(resolvedPath);
    if (!fileStats.isFile()) {
      await bot.sendMessage(chatId, '❌ 지정한 경로는 파일이 아닙니다.');
      return;
    }

    // 텔레그램 봇 파일 전송 용량 제한 (50MB)
    if (fileStats.size > 50 * 1024 * 1024) {
      await bot.sendMessage(chatId, '❌ 파일 크기가 Telegram 전송 한도(50MB)를 초과합니다.');
      return;
    }

    await bot.sendChatAction(chatId, 'upload_document');
    await bot.sendDocument(chatId, resolvedPath, {}, {
      filename: path.basename(resolvedPath),
      contentType: 'application/octet-stream'
    });
  } catch (error) {
    console.error(`[Command /download Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 파일 전송 실패: ${error.message}`);
  }
}

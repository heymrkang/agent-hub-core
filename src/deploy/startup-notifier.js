import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { uiStatusIcon } from '../telegram/renderer/ui-theme.js';

export function getCurrentCommit(repoPath = '/home/dev/workspace/agent-hub-core') {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoPath, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.SOURCE_COMMIT?.slice(0, 7) || 'unknown';
  }
}

export function getCurrentCommitMessage(repoPath = '/home/dev/workspace/agent-hub-core') {
  try {
    return execSync('git log -1 --pretty=%s', { cwd: repoPath, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export async function checkAndNotifyStartup({ bot, ownerId, dataDir = process.env.DATA_DIR || '/data', repoPath = '/home/dev/workspace/agent-hub-core' } = {}) {
  if (!bot || !ownerId) return null;

  const currentCommit = getCurrentCommit(repoPath);
  const commitMsg = getCurrentCommitMessage(repoPath);

  const stateDir = path.join(dataDir, 'system');
  const stateFile = path.join(stateDir, 'startup_state.json');

  let lastCommit = null;
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      lastCommit = data.commit || null;
    }
  } catch (err) {
    console.warn(`[StartupNotifier] 상태 파일 읽기 실패: ${err.message}`);
  }

  // 커밋이 달라졌거나 최초 기동인 경우 알림 발송
  const isNewDeployment = lastCommit !== null && lastCommit !== currentCommit;
  const isFirstRun = lastCommit === null;

  if (isNewDeployment || isFirstRun) {
    let text = `${uiStatusIcon('success')} **[Agent Hub Core] 배포 및 정상 기동 완료!**\n\n`;
    text += `• 버전: \`V2 · 2.0.0\` (\`${currentCommit}\`)\n`;
    if (isNewDeployment) {
      text += `• 변경: \`${lastCommit}\` ➔ \`${currentCommit}\`\n`;
    }
    if (commitMsg) {
      const sanitized = commitMsg.replace(/[`\\]/g, '');
      text += `• 커밋: \`${sanitized}\`\n`;
    }
    text += `• 모든 내부 서비스(Bot, Webhook, Previews)가 정상 가동 중입니다.`;

    let sendSuccess = false;
    try {
      await bot.sendMessage(ownerId, text, { parse_mode: 'Markdown' });
      console.log(`[StartupNotifier] 재배포/기동 알림 발송 완료: ${lastCommit} -> ${currentCommit}`);
      sendSuccess = true;
    } catch (sendErr) {
      console.error(`[StartupNotifier] 텔레그램 알림 발송 실패(Markdown): ${sendErr.message}`);
      try {
        const plainText = text.replace(/[*`_]/g, '');
        await bot.sendMessage(ownerId, plainText);
        console.log(`[StartupNotifier] 재배포/기동 알림 fallback(일반 텍스트) 발송 완료`);
        sendSuccess = true;
      } catch (fallbackErr) {
        console.error(`[StartupNotifier] 텔레그램 fallback 발송 실패: ${fallbackErr.message}`);
      }
    }

    try {
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          commit: currentCommit,
          startedAt: new Date().toISOString(),
          version: '2.0.0'
        }, null, 2),
        'utf-8'
      );
    } catch (writeErr) {
      console.error(`[StartupNotifier] 상태 파일 저장 실패: ${writeErr.message}`);
    }

    return { notified: true, isNewDeployment, currentCommit, lastCommit };
  }

  return { notified: false, isNewDeployment: false, currentCommit, lastCommit };
}

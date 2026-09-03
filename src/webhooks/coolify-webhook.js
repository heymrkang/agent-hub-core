import http from 'node:http';
import { uiStatusIcon } from '../telegram/renderer/ui-theme.js';

export function parseCoolifyPayload(body = {}) {
  const event = String(body.event || '').toLowerCase();
  const rawStatus = String(body.status || '').toLowerCase();

  const isSuccess =
    rawStatus === 'success' ||
    rawStatus === 'finished' ||
    event.includes('success') ||
    event.includes('finished');

  const isFailure =
    rawStatus === 'failed' ||
    rawStatus === 'error' ||
    event.includes('failed') ||
    event.includes('error');

  const appName =
    body.application_name ||
    body.name ||
    body.project_name ||
    body.app ||
    body.service_name ||
    'Coolify App';

  const rawCommit = body.commit || body.commit_hash || body.sha || '';
  const commit = rawCommit ? String(rawCommit).slice(0, 7) : '';
  const message = body.commit_message || body.message || '';
  const duration = body.duration || body.execution_time || '';
  const rawError = body.error || body.error_message || body.logs || '';
  const error = rawError
    ? String(rawError)
        .trim()
        .split('\n')
        .slice(-5)
        .join('\n')
    : '';

  return {
    isSuccess: isSuccess || (!isFailure && rawStatus !== ''),
    isFailure,
    appName,
    commit,
    message,
    duration,
    error
  };
}

export function formatDeployNotification(parsed) {
  const { isSuccess, isFailure, appName, commit, message, duration, error } = parsed;

  if (isFailure) {
    let text = `${uiStatusIcon('error')} **[${appName}] Coolify 배포 실패!**\n\n`;
    if (commit) text += `• Commit: \`${commit}\`${message ? ` (${message})` : ''}\n`;
    if (duration) text += `• 소요 시간: \`${duration}\`\n`;
    if (error) {
      text += `\n**실패 로그 요약**:\n\`\`\`\n${error}\n\`\`\``;
    }
    return text;
  }

  let text = `${uiStatusIcon('success')} **[${appName}] Coolify 배포 성공!**\n\n`;
  if (commit) text += `• Commit: \`${commit}\`${message ? ` (${message})` : ''}\n`;
  if (duration) text += `• 소요 시간: \`${duration}\`\n`;
  text += `• 서비스가 정상 가동 중입니다.`;
  return text;
}

export function createCoolifyWebhookHandler({ bot = null, adminUserId = null, secretToken = null } = {}) {
  const expectedToken = secretToken || process.env.WEBHOOK_SECRET || process.env.PREVIEW_INTERNAL_TOKEN || '';

  return async (req, res) => {
    // 1. Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: 'coolify-webhook' }));
      return;
    }

    // 2. Path routing
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_request' }));
      return;
    }

    if (url.pathname !== '/api/webhooks/coolify') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    // 3. Secret Token Verification (if configured)
    if (expectedToken) {
      const queryToken = url.searchParams.get('token');
      const headerToken = req.headers['x-coolify-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
      const providedToken = queryToken || headerToken || '';

      if (providedToken !== expectedToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    // 4. Read body
    let bodyText = '';
    req.on('data', (chunk) => {
      bodyText += chunk;
      if (bodyText.length > 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let body = {};
        if (bodyText) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            body = { message: bodyText };
          }
        }

        const parsed = parseCoolifyPayload(body);
        const notificationText = formatDeployNotification(parsed);

        const targetChatId = adminUserId ||
          process.env.TELEGRAM_ADMIN_USER_ID ||
          process.env.TELEGRAM_ALLOWED_USER_IDS?.split(',')[0]?.trim();

        if (bot && targetChatId) {
          await bot.sendMessage(targetChatId, notificationText, { parse_mode: 'Markdown' }).catch((err) => {
            console.error(`[Coolify Webhook] Telegram 푸시 실패: ${err.message}`);
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          app: parsed.appName,
          status: parsed.isFailure ? 'failed' : 'success'
        }));
      } catch (err) {
        console.error(`[Coolify Webhook] 처리 오류: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_server_error' }));
      }
    });
  };
}

export function startWebhookServer({ bot = null, port = null, host = null, secretToken = null } = {}) {
  const listenPort = Number(port || process.env.WEBHOOK_PORT || 8788);
  const listenHost = host || process.env.WEBHOOK_HOST || '0.0.0.0';

  const handler = createCoolifyWebhookHandler({ bot, secretToken });
  const server = http.createServer(handler);

  server.listen(listenPort, listenHost, () => {
    console.log(`[Webhook] Coolify 배포 수신 서버 시작: http://${listenHost}:${listenPort}/api/webhooks/coolify`);
  });

  server.on('error', (err) => {
    console.error(`[Webhook Server Error] ${err.message}`);
  });

  return server;
}

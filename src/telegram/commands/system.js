import { systemService } from '../../system/system-service.js';
import { isStealthMode } from '../renderer/ui-theme.js';

const STATES = { normal: { OK: '✅', WARN: '⚠️', CRITICAL: '🚨', UNKNOWN: '❔' }, stealth: { OK: '[OK]', WARN: '[WARN]', CRITICAL: '[CRITICAL]', UNKNOWN: '[UNKNOWN]' } };
const esc = (value) => String(value ?? '-').replace(/([_*`\[])/g, '\\$1');
const mark = (state) => STATES[isStealthMode() ? 'stealth' : 'normal'][state || 'UNKNOWN'];
const pct = (value) => Number.isFinite(value) ? `${value.toFixed(1)}%` : '-';
function size(value) { if (!Number.isFinite(value)) return '-'; const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let n = value, u = 0; while (n >= 1024 && u < 4) { n /= 1024; u++; } return `${n.toFixed(u > 1 ? 1 : 0)} ${units[u]}`; }
function age(value) { if (!Number.isFinite(value)) return '-'; const d = Math.floor(value / 86400), h = Math.floor(value % 86400 / 3600), m = Math.floor(value % 3600 / 60); return [d && `${d}일`, (d || h) && `${h}시간`, `${m}분`].filter(Boolean).join(' '); }
function worstDisk(items = []) { const rank = { UNKNOWN: 0, OK: 1, WARN: 2, CRITICAL: 3 }; return items.reduce((worst, item) => rank[item.severity] > rank[worst] ? item.severity : worst, 'UNKNOWN'); }
const title = () => `${isStealthMode() ? '■' : '🖥'} **System Resources**`;

export function renderOverview(snapshot) {
  if (!snapshot.servers.length) return `${title()}\n\n등록된 활성 서버가 없습니다.\n\`/server\`에서 서버를 등록하거나 활성화하세요.`;
  const servers = snapshot.servers.map((server) => {
    if (!server.online) return `${mark('UNKNOWN')} **${esc(server.alias)}** · OFFLINE\nSSH 수집 실패: ${esc(server.error || '응답 없음')}`;
    const docker = !server.docker.installed ? 'Docker N/A' : server.docker.available ? `Docker ${server.docker.running ?? '-'} running` : 'Docker UNKNOWN';
    return `${mark(server.severity)} **${esc(server.alias)}** · ${server.severity}\nCPU ${pct(server.cpu.usagePercent)} · RAM ${pct(server.memory.usagePercent)} · Disk ${pct(Math.max(...server.disks.items.map((item) => item.usagePercent ?? 0)))}\n${docker} · Uptime ${age(server.host.uptimeSeconds)}`;
  }).join('\n\n');
  return `${title()}\n\n${mark(snapshot.severity)} **전체 상태: ${snapshot.severity}**\n\n${servers}\n\nChecked: \`${esc(snapshot.checkedAt)}\``;
}

export function renderSystem(snapshot, page = 'overview') {
  if (!snapshot.online) return `${title()}\n\n${mark('UNKNOWN')} **${esc(snapshot.alias)} · OFFLINE**\n${esc(snapshot.error || 'SSH 응답 없음')}`;
  const { host: h, cpu: c, memory: m, disks: d, docker, runtime: r } = snapshot;
  const heading = `${title()}\n**${esc(snapshot.alias)}** · ${esc(h.hostname)}`;
  if (page === 'compute') return `${heading}\n\n**CPU**\n${mark(c.severity)} 사용률: **${pct(c.usagePercent)}** · Logical CPU: \`${c.cores}\`\nLoad Average: \`${c.load1?.toFixed(2)} / ${c.load5?.toFixed(2)} / ${c.load15?.toFixed(2)}\`\n\n**Host Memory**\n${mark(m.severity)} ${size(m.used)} / ${size(m.total)} · **${pct(m.usagePercent)}**\nAvailable: ${size(m.availableBytes)} · Swap: ${size(m.swapUsed)} / ${size(m.swapTotal)}`;
  if (page === 'storage') return `${heading}\n\n**Storage**\n${d.items?.map((item) => `${mark(item.severity)} **${esc(item.paths.join(', '))}**\n${size(item.used)} / ${size(item.total)} · **${pct(item.usagePercent)}** · Available ${size(item.availableBytes)}`).join('\n\n') || 'filesystem 없음'}`;
  if (page === 'docker') {
    if (!docker.installed) return `${heading}\n\n**Docker**\nN/A · 설치되지 않음`;
    if (!docker.available) return `${heading}\n\n**Docker**\n${mark('UNKNOWN')} ${esc(docker.error)}`;
    return `${heading}\n\n**Docker**\n${mark((docker.unhealthy || docker.restarting) ? 'WARN' : 'OK')} Daemon: \`${esc(docker.serverVersion)}\`\nContainers: ${docker.running ?? '-'} running · ${docker.stopped ?? '-'} stopped\nUnhealthy: ${docker.unhealthy ?? '-'} · Restarting: ${docker.restarting ?? '-'} · Images: ${docker.images ?? '-'}`;
  }
  if (page === 'runtime') {
    if (!r.installed) return `${heading}\n\n**Agent Hub Runtime**\nN/A · 이 서버에서 Agent Hub 컨테이너를 찾지 못함`;
    return `${heading}\n\n**Agent Hub Runtime**\n${mark(r.health === 'unhealthy' ? 'CRITICAL' : 'OK')} Container: **${esc(r.name)}** · \`${esc(r.state)}\`\nCPU: ${esc(r.cpuPercent)} · Memory: ${esc(r.memoryUsage)} (${esc(r.memoryPercent)})\nRestart: ${r.restartCount ?? '-'} · Started: \`${esc(r.startedAt)}\``;
  }
  const dockerText = !docker.installed ? 'Docker N/A' : !docker.available ? `${mark('UNKNOWN')} Docker daemon 응답 없음` : `${mark((docker.unhealthy || docker.restarting) ? 'WARN' : 'OK')} Docker ${docker.running ?? '-'} running · ${docker.stopped ?? '-'} stopped`;
  return `${heading}\n\n${mark(snapshot.severity)} **Overall: ${snapshot.severity}**\n\n**Host**\nOS: ${esc(h.os)}\nKernel: \`${esc(h.kernel)}\` · \`${esc(h.architecture)}\` · Uptime: ${age(h.uptimeSeconds)}\n\n**Resources**\n${mark(c.severity)} CPU ${pct(c.usagePercent)} · Load ${c.load1?.toFixed(2)} · ${c.cores} cores\n${mark(m.severity)} Memory ${pct(m.usagePercent)} · ${size(m.used)} / ${size(m.total)}\n${mark(worstDisk(d.items))} Storage ${d.items.map((item) => `${item.paths.join('+')} ${pct(item.usagePercent)}`).join(' · ')}\n${dockerText}\n\nChecked: \`${esc(snapshot.checkedAt)}\``;
}

function overviewKeyboard(servers) { return [...servers.slice(0, 20).map((server) => [{ text: `${mark(server.severity)} ${server.alias}`, callback_data: `system_host:${server.alias}` }]), [{ text: '↻ 전체 새로고침', callback_data: 'system_all_refresh' }]]; }
function detailKeyboard(alias, page) { return [[{ text: '‹ 전체 서버', callback_data: 'system_all' }], [{ text: '개요', callback_data: `system_detail:${alias}:overview` }, { text: 'CPU / Memory', callback_data: `system_detail:${alias}:compute` }], [{ text: 'Storage', callback_data: `system_detail:${alias}:storage` }, { text: 'Docker', callback_data: `system_detail:${alias}:docker` }], [{ text: 'Runtime', callback_data: `system_detail:${alias}:runtime` }, { text: '↻ 새로고침', callback_data: `system_refresh:${alias}:${page}` }]]; }
async function edit(bot, source, text, keyboard) { const chatId = source.chat?.id || source.message.chat.id, messageId = source.message?.message_id; const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }; if (messageId) return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((error) => { if (!/message is not modified/i.test(error.message)) throw error; }); return bot.sendMessage(chatId, text, options); }
async function showOverview(bot, source, userId, force, service) { const snapshot = await service.getOverview(userId, { force }); return edit(bot, source, renderOverview(snapshot), overviewKeyboard(snapshot.servers)); }
async function showDetail(bot, source, userId, alias, page, force, service) { const snapshot = await service.getServer(userId, alias, { force }); return edit(bot, source, renderSystem(snapshot, page), detailKeyboard(alias, page)); }

export async function handleSystemCommand(bot, msg, args = '', service = systemService) {
  const alias = String(args || '').trim(); const waiting = await bot.sendMessage(msg.chat.id, isStealthMode() ? '■ 등록 서버 리소스 수집 중...' : '🔎 등록 서버 리소스 수집 중...');
  try { return alias ? await showDetail(bot, { message: waiting }, msg.from.id, alias, 'overview', false, service) : await showOverview(bot, { message: waiting }, msg.from.id, false, service); }
  catch (error) { return bot.editMessageText(`${mark('UNKNOWN')} System 조회 실패: ${error.message}`, { chat_id: msg.chat.id, message_id: waiting.message_id }); }
}

export async function handleSystemCallback(bot, q, service = systemService) {
  await bot.answerCallbackQuery(q.id).catch(() => {}); const parts = String(q.data || '').split(':');
  try {
    if (parts[0] === 'system_all' || parts[0] === 'system_all_refresh') return showOverview(bot, q, q.from.id, parts[0] === 'system_all_refresh', service);
    if (parts[0] === 'system_host') return showDetail(bot, q, q.from.id, parts[1], 'overview', false, service);
    if (parts[0] === 'system_detail') return showDetail(bot, q, q.from.id, parts[1], parts[2] || 'overview', false, service);
    if (parts[0] === 'system_refresh') return showDetail(bot, q, q.from.id, parts[1], parts[2] || 'overview', true, service);
  } catch (error) { return bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`.slice(0, 180), show_alert: true }).catch(() => {}); }
}

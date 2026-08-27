import fs from 'fs';
import path from 'path';

export const SSH_ROOT = process.env.SSH_DATA_DIR || '/data/ssh';
export const SSH_KEYS_DIR = path.join(SSH_ROOT, 'keys');
export const SSH_CONFIG_PATH = path.join(SSH_ROOT, 'config');
export const SSH_KNOWN_HOSTS_PATH = path.join(SSH_ROOT, 'known_hosts');

function ensureFile(filePath, mode) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', { mode });
  fs.chmodSync(filePath, mode);
}

export function ensureSshLayout() {
  fs.mkdirSync(SSH_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(SSH_KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(SSH_ROOT, 0o700);
  fs.chmodSync(SSH_KEYS_DIR, 0o700);
  ensureFile(SSH_CONFIG_PATH, 0o600);
  ensureFile(SSH_KNOWN_HOSTS_PATH, 0o600);

  const homeSsh = path.join(process.env.HOME || '/root', '.ssh');
  fs.mkdirSync(homeSsh, { recursive: true, mode: 0o700 });
  fs.chmodSync(homeSsh, 0o700);

  for (const [targetName, sourcePath] of [['config', SSH_CONFIG_PATH], ['known_hosts', SSH_KNOWN_HOSTS_PATH]]) {
    const target = path.join(homeSsh, targetName);
    try {
      if (fs.existsSync(target) || fs.lstatSync(target)) fs.rmSync(target, { force: true });
    } catch {}
    fs.symlinkSync(sourcePath, target);
  }
}

function sanitizeConfigValue(value) {
  return String(value).replace(/[\r\n]/g, '').trim();
}

export function generateSshConfig(hosts) {
  ensureSshLayout();
  const lines = [
    '# Managed by Agent Hub Core. Manual edits may be overwritten.',
    `Host *`,
    `  UserKnownHostsFile ${SSH_KNOWN_HOSTS_PATH}`,
    `  StrictHostKeyChecking accept-new`,
    `  BatchMode yes`,
    ''
  ];

  for (const host of hosts.filter((h) => h.enabled)) {
    lines.push(`Host ${sanitizeConfigValue(host.alias)}`);
    lines.push(`  HostName ${sanitizeConfigValue(host.host)}`);
    lines.push(`  Port ${Number(host.port) || 22}`);
    lines.push(`  User ${sanitizeConfigValue(host.username)}`);
    lines.push(`  IdentityFile ${sanitizeConfigValue(host.identity_file)}`);
    lines.push('  IdentitiesOnly yes');
    lines.push('');
  }

  const temp = `${SSH_CONFIG_PATH}.tmp`;
  fs.writeFileSync(temp, `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.renameSync(temp, SSH_CONFIG_PATH);
  fs.chmodSync(SSH_CONFIG_PATH, 0o600);
  return SSH_CONFIG_PATH;
}

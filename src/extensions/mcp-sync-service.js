import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpRepository } from './mcp-repository.js';

function getCodexConfigPath() {
  if (process.env.CODEX_CONFIG_PATH) return process.env.CODEX_CONFIG_PATH;
  if (process.env.CODEX_HOME) return path.join(process.env.CODEX_HOME, 'config.toml');
  return path.join(os.homedir(), '.codex', 'config.toml');
}

function getGeminiConfigPath() {
  if (process.env.GEMINI_MCP_PATH) return process.env.GEMINI_MCP_PATH;
  const home = process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini');
  return path.join(home, 'config', 'mcp_config.json');
}

function safeWriteAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.tmp_${path.basename(targetPath)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, targetPath);
}

/**
 * Strips all [mcp_servers.*] sections from existing TOML content,
 * preserving top-level keys and other sections ([projects], etc.).
 */
export function stripMcpSectionsFromToml(tomlContent) {
  if (!tomlContent) return '';
  const lines = tomlContent.split(/\r?\n/);
  const kept = [];
  let inMcpSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      if (/^\[mcp_servers(\.|\s|$)/i.test(trimmed)) {
        inMcpSection = true;
        continue;
      } else {
        inMcpSection = false;
      }
    }
    if (!inMcpSection) {
      kept.push(line);
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Builds the [mcp_servers.*] TOML string from active/registered MCP servers.
 */
export function buildCodexMcpToml(servers, env = process.env) {
  const blocks = [];
  for (const server of servers) {
    const lines = [];
    lines.push(`[mcp_servers.${server.name}]`);
    if (server.transport === 'stdio') {
      lines.push(`command = ${JSON.stringify(server.command || '')}`);
      lines.push(`args = ${JSON.stringify(server.args || [])}`);
    } else if (server.transport === 'http') {
      lines.push(`url = ${JSON.stringify(server.url || '')}`);
      if (server.headers && Object.keys(server.headers).length > 0) {
        lines.push(`http_headers = ${JSON.stringify(server.headers)}`);
      }
    }
    lines.push(`enabled = ${server.enabled ? 'true' : 'false'}`);

    // Map env vars if stdio
    if (server.transport === 'stdio' && Array.isArray(server.envKeys) && server.envKeys.length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${server.name}.env]`);
      for (const key of server.envKeys) {
        const val = env[key] !== undefined ? String(env[key]) : '';
        lines.push(`${key} = ${JSON.stringify(val)}`);
      }
    }

    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Builds the mcp_config.json object for Antigravity (agy).
 */
export function buildGeminiMcpConfig(servers, existingConfig = {}, env = process.env) {
  const mcpServers = {};

  for (const server of servers) {
    if (server.transport === 'stdio') {
      const entry = {
        command: server.command || '',
        disabled: !server.enabled
      };
      if (Array.isArray(server.args) && server.args.length > 0) {
        entry.args = server.args;
      }
      if (Array.isArray(server.envKeys) && server.envKeys.length > 0) {
        entry.env = {};
        for (const key of server.envKeys) {
          entry.env[key] = env[key] !== undefined ? String(env[key]) : '';
        }
      }
      mcpServers[server.name] = entry;
    } else if (server.transport === 'http') {
      const entry = {
        serverUrl: server.url || '',
        disabled: !server.enabled
      };
      if (server.headers && Object.keys(server.headers).length > 0) {
        entry.headers = server.headers;
      }
      mcpServers[server.name] = entry;
    }
  }

  return {
    ...existingConfig,
    mcpServers
  };
}

export class McpSyncService {
  constructor({
    codexConfigPath = null,
    geminiConfigPath = null,
    env = process.env
  } = {}) {
    this.codexConfigPath = codexConfigPath || getCodexConfigPath();
    this.geminiConfigPath = geminiConfigPath || getGeminiConfigPath();
    this.env = env;
  }

  syncCodex(servers) {
    let existing = '';
    try {
      if (fs.existsSync(this.codexConfigPath)) {
        existing = fs.readFileSync(this.codexConfigPath, 'utf8');
      }
    } catch (err) {
      console.warn(`[McpSync] Codex config 읽기 실패: ${err.message}`);
    }

    const baseToml = stripMcpSectionsFromToml(existing);
    const mcpToml = buildCodexMcpToml(servers, this.env);
    const finalContent = baseToml
      ? (mcpToml ? `${baseToml}\n\n${mcpToml}\n` : `${baseToml}\n`)
      : (mcpToml ? `${mcpToml}\n` : '');

    safeWriteAtomic(this.codexConfigPath, finalContent);
    return { path: this.codexConfigPath, count: servers.length };
  }

  syncGemini(servers) {
    let existingObj = {};
    try {
      if (fs.existsSync(this.geminiConfigPath)) {
        const raw = fs.readFileSync(this.geminiConfigPath, 'utf8');
        existingObj = JSON.parse(raw);
      }
    } catch {
      existingObj = {};
    }

    const finalObj = buildGeminiMcpConfig(servers, existingObj, this.env);
    const finalContent = JSON.stringify(finalObj, null, 2) + '\n';
    safeWriteAtomic(this.geminiConfigPath, finalContent);
    return { path: this.geminiConfigPath, count: servers.length };
  }

  syncAll() {
    const servers = McpRepository.list();
    const codex = this.syncCodex(servers);
    const gemini = this.syncGemini(servers);
    return {
      syncedAt: new Date().toISOString(),
      serversCount: servers.length,
      codex,
      gemini
    };
  }
}

export const mcpSyncService = new McpSyncService();

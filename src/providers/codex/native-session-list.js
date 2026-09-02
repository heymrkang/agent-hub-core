function epochSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function shortTitle(value, fallback = 'Codex Session') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function normalizeCodexThreadList(result) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  return {
    sessions: rows.map((thread) => ({
      nativeSessionRef: String(thread?.id || ''),
      sessionId: thread?.sessionId ?? thread?.session_id ?? null,
      title: shortTitle(thread?.name || thread?.preview),
      preview: String(thread?.preview || '').trim(),
      cwd: thread?.cwd ? String(thread.cwd) : null,
      model: thread?.model || null,
      reasoningEffort: thread?.reasoningEffort ?? thread?.reasoning_effort ?? null,
      source: thread?.source || null,
      status: thread?.status ?? null,
      createdAt: epochSecondsToIso(thread?.createdAt ?? thread?.created_at),
      updatedAt: epochSecondsToIso(thread?.updatedAt ?? thread?.updated_at),
      ephemeral: Boolean(thread?.ephemeral)
    })).filter((session) => session.nativeSessionRef),
    nextCursor: result?.nextCursor ?? result?.next_cursor ?? null
  };
}

export const CODEX_NATIVE_SESSION_SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer'];

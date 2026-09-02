import { providerManager } from '../providers/provider-manager.js';
import { SessionManager } from './session-manager.js';
import { ProviderSessionRepository } from './provider-session-repository.js';

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) throw new Error('Provider 이름이 필요합니다.');
  return value;
}

function mappedRowToNativeSession(row) {
  return {
    nativeSessionRef: row.native_session_ref,
    title: row.logical_title || `${row.provider} native session`,
    preview: row.logical_title || '',
    cwd: null,
    model: row.logical_model || null,
    reasoningEffort: row.logical_reasoning_effort || null,
    source: 'agent-hub-mapping',
    status: row.state,
    createdAt: row.bound_at || null,
    updatedAt: row.last_verified_at || row.updated_at || row.logical_updated_at || null,
    mappedLogicalSessionId: row.session_id,
    mappedLogicalTitle: row.logical_title || null,
    mappedLogicalStatus: row.logical_status || null,
    mappedUserId: row.user_id
  };
}

export class NativeSessionService {
  static async listForProvider({ userId = null, provider, cursor = null, limit = 20 }) {
    const pName = normalizeProvider(provider);
    const adapter = providerManager.getAdapter(pName);

    if (typeof adapter.listNativeSessions !== 'function') {
      if (userId === null || userId === undefined) {
        const error = new Error(`${pName} Provider는 native session 목록 조회를 지원하지 않습니다.`);
        error.code = 'NATIVE_SESSION_LIST_UNSUPPORTED';
        throw error;
      }
      const rows = ProviderSessionRepository.listReadyByUserProvider(userId, pName, limit);
      return {
        provider: pName,
        sessions: rows.map(mappedRowToNativeSession),
        nextCursor: null,
        source: 'mapping-fallback',
        listCapability: 'MAPPED_ONLY'
      };
    }

    const result = await adapter.listNativeSessions({ cursor, limit });
    const sessions = (result?.sessions || []).map((native) => {
      const mapping = ProviderSessionRepository.findByNativeRef(pName, native.nativeSessionRef);
      return {
        ...native,
        mappedLogicalSessionId: mapping?.session_id || null,
        mappedLogicalTitle: mapping?.logical_title || null,
        mappedLogicalStatus: mapping?.logical_status || null,
        mappedUserId: mapping?.user_id ?? null
      };
    });
    return {
      provider: pName,
      sessions,
      nextCursor: result?.nextCursor || null,
      source: 'provider-native',
      listCapability: 'FULL'
    };
  }

  static adopt({ userId, provider, nativeSession, profile = 'WORKSPACE' }) {
    const pName = normalizeProvider(provider);
    const nativeRef = String(nativeSession?.nativeSessionRef || '').trim();
    if (!nativeRef) throw new Error('adopt할 native session ref가 없습니다.');

    const existing = ProviderSessionRepository.findByNativeRef(pName, nativeRef);
    if (existing) {
      if (String(existing.user_id) !== String(userId)) {
        const error = new Error('다른 사용자의 Logical Session에 이미 연결된 native session입니다.');
        error.code = 'NATIVE_SESSION_OWNERSHIP_CONFLICT';
        throw error;
      }
      const logical = SessionManager.getSession(existing.session_id);
      if (!logical || logical.is_system) throw new Error('연결된 Logical Session을 사용할 수 없습니다.');
      if (logical.status !== 'ACTIVE') SessionManager.restoreSession(logical.id);
      SessionManager.setActiveSession(userId, logical.id);
      return { session: SessionManager.getSession(logical.id), mapping: ProviderSessionRepository.get(logical.id, pName), adopted: false };
    }

    const session = SessionManager.createSession(userId, {
      title: nativeSession.title || nativeSession.preview || `${pName} native session`,
      provider: pName,
      model: nativeSession.model || null,
      reasoningEffort: nativeSession.reasoningEffort || 'default',
      profile
    });
    const mapping = ProviderSessionRepository.bind({
      sessionId: session.id,
      provider: pName,
      nativeSessionRef: nativeRef,
      metadata: {
        adopted: true,
        source: nativeSession.source || null,
        cwd: nativeSession.cwd || null,
        nativeCreatedAt: nativeSession.createdAt || null,
        nativeUpdatedAt: nativeSession.updatedAt || null
      },
      verified: true
    });
    return { session: SessionManager.getSession(session.id), mapping, adopted: true };
  }
}

function nativeRefFromPayload(parsed) {
  return parsed?.conversation_id ?? parsed?.conversationId ?? parsed?.session_id ?? parsed?.sessionId ?? null;
}

export function parseAntigravityExecutionResponse(raw, { nativeSessionRef = null } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || '').trim());
  } catch (cause) {
    const error = new Error(`Antigravity JSON 응답 파싱 실패: ${cause.message}`);
    error.code = 'ANTIGRAVITY_JSON_PARSE_ERROR';
    error.cause = cause;
    throw error;
  }

  if (parsed?.status && parsed.status !== 'SUCCESS') {
    const error = new Error(parsed.error || `Antigravity 응답 상태 오류: status=${parsed.status}`);
    error.code = nativeSessionRef ? 'ANTIGRAVITY_NATIVE_RESUME_FAILED' : 'ANTIGRAVITY_EXECUTION_FAILED';
    throw error;
  }

  const emittedRef = nativeRefFromPayload(parsed);
  if (nativeSessionRef && emittedRef && String(emittedRef) !== String(nativeSessionRef)) {
    const error = new Error(`Antigravity resume conversation 불일치: expected=${nativeSessionRef}, actual=${emittedRef}`);
    error.code = 'ANTIGRAVITY_NATIVE_SESSION_MISMATCH';
    throw error;
  }

  const resolvedRef = emittedRef || nativeSessionRef || null;
  if (!nativeSessionRef && !resolvedRef) {
    const error = new Error('Antigravity 새 native conversation 실행에서 conversation_id를 받지 못했습니다.');
    error.code = 'ANTIGRAVITY_NATIVE_SESSION_ID_MISSING';
    throw error;
  }

  return {
    response: parsed?.response ?? parsed?.result ?? '',
    nativeSessionRef: resolvedRef,
    nativeSessionCreated: !nativeSessionRef,
    usage: parsed?.usage ?? null
  };
}

# Phase 18: V2 Native Session Compact & Rollover

## Status

`DONE`

## 1. 배경 및 문제점

Agent Hub Core V2에서 Provider-Native Session First 구조로 전환됨에 따라 다음과 같은 문제가 발생했다.
- 사용자가 `/compact`를 실행하면 SQLite DB의 `rolling_summary`만 업데이트될 뿐, 실제 Provider(Codex/Antigravity)의 내부 대화 스레드(`native_session_ref`)는 그대로 유지되어 AI 엔진 레벨의 토큰/컨텍스트가 전혀 줄어들지 않았다.
- 네이티브 세션 대화 경로에서 Auto Compact는 `NATIVE_SESSION_BYPASS`로 완전히 비활성화되어 있었다.
- Provider Handoff 시점에만 요약본이 사용되고 동일 Provider로 계속 대화할 때는 압축 효과가 없었다.

## 2. 설계 및 목표

1. **전체 Provider Native Session 롤오버 (Unbind & Reseed)**:
   - `/compact` 실행 시 대화 원문 요약(`rolling_summary`) 생성 및 cursor 업데이트는 그대로 수행.
   - 해당 Logical Session에 매핑된 **모든 Provider(Codex, Antigravity)의 `provider_sessions`를 `UNBOUND` 상태로 일괄 초기화** (`native_session_ref = NULL`, `state = 'UNBOUND'`).
2. **신규 Native Session 부트스트랩**:
   - 이후 다음 턴에서 활성 Provider는 `UNBOUND` 상태이므로 `BOOTSTRAP` 모드로 전환.
   - `[대화 요약] + 최근 원문 메시지 + 신규 요청`을 프롬프트로 전달하여 가벼운 새 네이티브 세션 생성 및 바인딩.
3. **Provider 전환 정합성 보장**:
   - 다른 Provider로 전환하더라도 이미 `UNBOUND` 상태이므로 동일한 `rolling_summary`를 기반으로 깨끗한 새 세션을 생성하여 문맥 불일치(Desync) 방지.
4. **검증 및 테스트**:
   - 단위 테스트 및 E2E 테스트로 `/compact` 후 ProviderSession의 UNBOUND 전이 및 신규 세션 바인딩 확인.

## 3. 체크리스트

- [x] 18-1 Compactor 로직 보강: `Compactor.compactSession`에서 해당 세션의 모든 provider_sessions를 `resetAllToUnbound` 처리
- [x] 18-2 ContextAssembler 및 텔레그램 피드백 갱신: 압축 완료 시 Provider 네이티브 세션이 리셋/롤오버됨을 사용자에게 명확히 안내
- [x] 18-3 회귀 방지 단위 테스트 작성 (`tests/unit/context-compactor.test.js`)
- [x] 18-4 전체 테스트 스위트 검증 및 문서 상태 최신화

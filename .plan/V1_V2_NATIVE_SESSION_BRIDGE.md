# V1 → V2 Native Session Bridge

## Status

`IN_PROGRESS — Bridge-1 foundation 구현, Codex native create/resume contract live-confirmed`

이 문서는 Agent Hub Core가 V1의 **Agent Hub-owned context reconstruction**에서 V2의 **Provider-native session first** 구조로 넘어가는 전환 기록이다.

이번 작업은 Phase 18이 아니다. 이미 계획된 Phase 18(MCP/Skills)은 그대로 유지하며, 본 작업은 V1↔V2 사이의 architecture bridge로 관리한다.

상태는 구현과 검증에 따라 `PLANNED → IN_PROGRESS → LIVE_VALIDATION → DONE`으로 갱신한다.

---

## 1. 왜 이 Bridge가 필요한가

V1 일반 대화는 매 turn마다 Provider prompt를 다시 만든다.

```text
Global Memory
+ rolling_summary
+ compact cursor 이후 최근 canonical messages
+ 현재 prompt
```

이 구조에서는 실제 대화에서 작업 1~10을 완료했더라도 summary/recent tail에 10 완료 사실이 없으면 다음 실행이 과거 단계로 회귀할 수 있다.

핵심 문제는 모델 능력이 아니라 **conversation authority가 잘못 배치된 것**이다.

V1에서 Agent Hub는 Provider CLI가 이미 보유한 native conversation을 충분히 활용하지 않고 canonical transcript의 일부를 다시 조립해 매번 새 실행에 설명한다. 따라서 요약/최근 대화에서 누락된 정보는 같은 Provider를 계속 사용하는 상황에서도 사라질 수 있다.

현재 코드 감사 결과:

- `ContextAssembler`가 normal turn마다 rolling summary + recent canonical history를 재주입한다.
- `QueueManager`는 이미 `provider_sessions.native_session_ref`를 Adapter에 전달하고 결과 ref를 저장할 골격이 있다.
- `provider_sessions`, `provider_handoffs` schema도 이미 존재한다.
- AntigravityAdapter는 `--conversation <id>`와 result `conversation_id`를 일부 연결한다.
- CodexAdapter는 native resume capability를 `PARTIAL`로 표시하지만 실제 일반 실행은 새 `codex exec`다.

즉 완전 신규 시스템을 만드는 것이 아니라 **V1에서 반쯤 존재하는 native-session mapping을 primary architecture로 승격**하는 작업이다.

---

## 2. Architecture Principle

> **Agent Hub Core는 대화를 소유하지 않는다. Provider native conversation을 연결하고 중계한다.**

권위는 다음처럼 나눈다.

```text
Provider Native Session
= 실제 AI conversation continuity
= same-provider primary conversational memory

Agent Hub Logical Session
= Telegram에서 사용자가 보는 작업 단위
= Provider별 native session identity를 묶는 bridge key

Agent Hub messages
= transcript / audit / handoff / recovery evidence
= same-provider normal turn의 primary memory가 아님

rolling_summary + recent canonical messages
= cross-provider handoff / V1 migration / explicit recovery 용도
= same-provider normal turn마다 재주입하지 않음
```

### 핵심 invariant

native session이 정상적으로 존재하는 same-provider turn에서는 과거 chat transcript를 Agent Hub가 다시 조립하지 않는다.

```text
Logical A
└─ Codex native abc123

User: "17-6-2 진행"
→ codex exec resume abc123 "17-6-2 진행"
```

다음은 V2 정상 hot path에서 금지한다.

```text
summary + 최근 대화 + 현재 요청
→ 새 codex exec
```

---

## 3. Logical Session ↔ Provider Native Session

목표 상태:

```text
Logical Session A
├─ codex
│  ├─ native_session_ref = abc123
│  ├─ state = READY
│  └─ last_synced_message_id = m80
└─ antigravity
   ├─ native_session_ref = xyz789
   ├─ state = READY
   └─ last_synced_message_id = m57
```

Agent Hub DB가 관리하는 것:

- 사용자 ↔ Logical Session
- active Provider / Model / Thinking / Profile
- Logical Session ↔ Provider native ref
- Provider별 sync cursor
- native mapping lifecycle state
- provider handoff 이력
- canonical transcript / jobs / attachments / audit

DB가 하지 않는 것:

- Provider가 이미 기억하는 전체 conversation을 매 요청마다 재현
- native session이 정상인데 rolling summary를 primary memory처럼 사용

---

## 4. Provider Session Lifecycle

Bridge lifecycle state:

```text
UNBOUND
  Logical session은 있으나 해당 Provider native identity는 아직 없음

READY
  native_session_ref가 있고 continuation 가능한 정상 상태

MISSING
  저장된 native ref가 Provider 저장소에서 사라졌거나 찾을 수 없음

ERROR
  native mapping 관련 오류가 발생했으나 MISSING 여부를 확정할 수 없음
```

DB metadata:

```text
native_session_ref
last_synced_message_id
state
bound_at
last_verified_at
last_error
metadata_json
```

Invariant:

```text
UNIQUE(logical session, provider)
```

한 Logical Session에 같은 Provider mapping이 둘 이상 존재하면 어떤 native conversation이 진짜인지 추측하지 않는다.

---

## 5. Provider Adapter 계약

구현 단계에서 최종 함수명은 조정할 수 있지만 Provider-specific CLI syntax는 Adapter 밖으로 새지 않아야 한다.

의미상 필요한 capability:

```text
startNativeSession(prompt, options)
resumeNativeSession(nativeSessionRef, prompt, options)
listNativeSessions(options)
getNativeSession(nativeSessionRef)
```

선택 capability:

```text
renameNativeSession
archive/deleteNativeSession
```

공통 execute result 최소 계약:

```js
{
  response,
  nativeSessionRef,
  nativeSessionCreated,
  usage
}
```

새 native session을 만들었는데 native ref를 확보하지 못하면 성공으로 가장하지 않는다.

---

## 6. Codex 0.149.1 — Live Contract

2026-09-02 실제 Agent Hub 컨테이너에서 확인했다.

```text
codex-cli 0.149.1
```

### create

`codex exec`는 기본적으로 persistent session을 만들며 `--ephemeral`을 쓰지 않는 한 session file을 저장한다.

구조화 실행:

```text
codex exec --json <prompt>
```

실제 첫 event:

```json
{"type":"thread.started","thread_id":"<UUID>"}
```

따라서 **Codex native identity canonical source는 `thread.started.thread_id`**로 확정한다.

실제 probe에서는 이후 `turn.started`, `item.completed`, `turn.completed` JSONL event도 확인됐다.

### resume

실제 설치 CLI help에서 다음 계약을 확인했다.

```text
codex exec resume [SESSION_ID] [PROMPT]
```

SESSION_ID는 UUID 또는 thread name을 받는다.

따라서 Bridge 실행 경로:

```text
native ref 없음
→ codex exec --json ... <prompt>
→ thread.started.thread_id capture
→ READY bind

native ref 있음
→ codex exec resume --json ... <thread_id> <current prompt>
→ 같은 thread continuation
```

### fork

`codex exec fork`도 존재하지만 Bridge `/new` 기본 동작에는 사용하지 않는다. `/new`는 새 conversation이다.

### 아직 미확정

`/sessions` 구현을 위해 다음은 별도 확정이 필요하다.

- non-interactive native session list source
- Codex local session store의 안정적 schema/API
- title / cwd / updated-at metadata source

TUI 화면 scraping은 사용하지 않는다.

---

## 7. Antigravity Native Session

현재 Adapter와 CLI 계약상 다음 기반이 이미 존재한다.

```text
agy --conversation <conversation-id>
headless JSON conversation_id
```

현재 Adapter는 첫 실행 결과에서 `conversation_id` 계열을 `nativeSessionRef`로 반환할 수 있다.

Bridge에서 formal contract로 승격한다.

```text
native ref 없음
→ conversation option 없이 첫 prompt
→ conversation_id required
→ READY bind

native ref 있음
→ --conversation <id>
→ current prompt only
```

필요 시 구현 단계에서 실제 컨테이너 live probe를 추가한다.

Persistent stream-json worker 최적화는 이번 Bridge non-goal이다. 먼저 correctness를 확보한다.

---

## 8. `/new`

Bridge 기본안은 **lazy native binding**이다.

```text
/new
→ 새 Logical Session 생성
→ 기본 Provider/Model/Thinking/Profile 설정
→ active Provider mapping = UNBOUND
→ Telegram에 새 Logical Session 즉시 제공
```

첫 user turn 성공 시:

```text
UNBOUND
→ Provider 새 native session 실행
→ native ref capture
→ READY bind
```

Provider 호출 실패 시 새 Logical Session은 남을 수 있지만 READY라고 표시하지 않는다.

---

## 9. `/sessions`

최종 UX 원칙:

```text
현재 Provider = Codex
/sessions → Codex native sessions

현재 Provider = Antigravity
/sessions → Antigravity native conversations
```

Agent Hub DB session 목록을 native 목록인 것처럼 보여주지 않는다.

Provider CLI에서 직접 만든 native session도 선택 가능해야 한다.

mapping이 없는 native session 선택:

```text
native session 선택
→ 기존 logical mapping 검색
→ 없으면 logical session adopt/import
→ provider_sessions READY mapping 생성
→ active logical session 설정
```

Bridge 첫 버전에서는 native delete를 logical purge와 자동 연결하지 않는다.

---

## 10. `/model` Provider Handoff

### Same Provider model 변경

native session identity를 유지한다. Resume 과정에서 model override가 지원되면 target model을 전달한다.

### 최초 target Provider 전환

예: Codex A → Antigravity A

```text
Codex native abc123
Antigravity mapping UNBOUND
↓
canonical transcript 기반 bootstrap handoff 생성
↓
Antigravity 첫 turn에 1회 포함
↓
conversation_id xyz789 확보
↓
Antigravity mapping READY
↓
전환 commit
```

### 기존 target Provider로 복귀

```text
Codex cursor = m80
Antigravity cursor = m57
↓
Antigravity로 복귀
↓
m58~m80 delta + current prompt를 기존 xyz789에 1회 전달
↓
성공 후 Antigravity cursor 갱신
```

Provider 왕복 시 매번 새 conversation을 만들지 않는다.

### 손실 정책

Cross-provider에서는 hidden reasoning/tool state를 100% 이동할 수 없을 수 있다.

따라서 목표는:

```text
Same Provider
→ native continuity 최대 보존

Cross Provider
→ canonical bootstrap/delta 기반 best-effort handoff
```

---

## 11. Prompt Assembly 역할 재정의

세 경로로 분리한다.

### Native continuation

```text
최소 global instruction/memory
+ current prompt
```

과거 chat transcript 재주입 금지.

### Provider handoff

```text
rolling summary
+ target Provider가 아직 모르는 canonical delta
+ current prompt
```

### Legacy/recovery bootstrap

기존 V1 세션 또는 명시적 recovery에서 reconstruction을 **한 번만** 사용한다.

```text
V1 context bootstrap
→ 새 native session bind
→ 이후 native continuation
```

V1 reconstruction은 permanent runtime 방식에서 migration/recovery 도구로 격하한다.

---

## 12. Compact의 새로운 위치

V1에서는 ContextAssembler hot path와 auto compact가 강하게 연결돼 있다.

Native-session first 이후 compact는 같은 의미가 아니다.

기존 canonical compact 데이터는 삭제하지 않는다. 다음 용도로 유지한다.

- cross-provider handoff summary
- legacy bootstrap
- broken native session recovery
- audit/history summary

same-provider normal turn의 native memory를 Agent Hub compact가 대체하지 않는다.

Provider native compact가 안정적으로 노출되면 V2 이후 별도로 정의한다.

---

## 13. Failure / Transaction Semantics

### Resume 실패

금지:

```text
resume 실패
→ 몰래 새 session
→ full history 주입
→ 정상 응답처럼 반환
```

정상 처리:

```text
resume 실패
→ MISSING 또는 ERROR
→ 명확한 job failure
→ explicit recovery
```

### Handoff 실패

V1 HandoffManager는 active provider 변경과 실제 target execution이 분리돼 있다.

Bridge 목표:

```text
target native prepare/bootstrap/delta execution
→ 성공
→ mapping + cursor 저장
→ active_provider switch commit
```

실패하면 기존 Provider/native session을 유지한다.

### Logging

- prompt/history 전체 operational logging 금지
- secret redaction 유지
- native ref 로그는 short ref만 사용
- create/resume/handoff/missing state event는 관측 가능하게 기록

---

## 14. Queue / Concurrency

Serialization key는 Logical Session을 유지한다.

```text
Logical A
→ conversational state-mutating job 최대 1개
```

동일 logical session에서 Provider turn, `/model` handoff, adopt/recovery가 경쟁하면 native cursor ordering이 깨질 수 있으므로 같은 session guard를 공유한다.

Provider global concurrency limit은 기존 정책을 유지한다.

---

## 15. Rename / Delete

Logical title과 Provider native title은 별도 identity다.

Bridge 첫 버전:

- logical rename 유지
- native rename은 capability가 명확할 때만 추가
- logical transcript delete ≠ native history delete
- logical purge가 Provider native history를 자동 삭제하지 않음

---

## 16. Observability 목표

예시:

```text
[NativeSession] create provider=codex logical=<short> native=<short>
[NativeSession] resume provider=codex logical=<short> native=<short>
[NativeSession] handoff codex->antigravity logical=<short> delta_messages=N
[NativeSession] adopted provider=antigravity logical=<short> native=<short>
[NativeSession] missing provider=codex logical=<short> native=<short>
```

운영 KPI:

- same-provider normal-turn reconstruction fallback = 0
- native create/resume 성공률
- legacy bootstrap 횟수
- provider handoff delta 크기
- MISSING/recovery 발생 횟수

---

## 17. Bridge Work Stages

### Bridge-0 — Design & Live Capability Probe

Status: `PARTIAL DONE`

- [x] V1 context / queue / handoff 구조 감사
- [x] 기존 provider_sessions mapping 확인
- [x] Codex 0.149.1 version live 확인
- [x] `codex exec resume` live contract 확인
- [x] `codex exec --json` native ID event 확인
- [x] native ID source = `thread.started.thread_id` 확정
- [x] Antigravity current `--conversation` implementation 확인
- [ ] Codex native session list source 확정
- [ ] 필요 시 Antigravity list/live contract probe

Bridge-0은 `/sessions` 구현 직전까지 열어둔다. Create/resume 구현에는 blocker가 없다.

### Bridge-1 — Native Session Repository & Schema

Status: `IMPLEMENTED — CI pending`

- [x] migration `015_native_session_bridge.sql`
- [x] lifecycle metadata (`state`, `bound_at`, `last_verified_at`, `last_error`, `metadata_json`)
- [x] existing native ref → READY migration
- [x] `(session_id, provider)` unique invariant
- [x] historical duplicate가 있으면 silent deletion 대신 migration fail 정책
- [x] `ProviderSessionRepository`
- [x] ensure / bind / cursor / verified / failure / reset lifecycle
- [x] ContextManager compatibility delegation
- [x] focused migration/repository tests
- [ ] GitHub Actions regression success

### Bridge-2 — Codex Native Create/Resume

- [ ] JSONL event parser
- [ ] `thread.started.thread_id` capture
- [ ] `codex exec resume <thread_id>` argument path
- [ ] FULL_ACCESS integration
- [ ] restricted helper integration / `/root/.codex` persistence 유지
- [ ] model/reasoning/profile option parity
- [ ] timeout/cancel telemetry parity
- [ ] session-not-found classification
- [ ] focused tests

Exit: Codex 두 번째 turn부터 reconstructed history 없이 같은 thread resume.

### Bridge-3 — Antigravity Native Create/Resume Hardening

- [ ] first-turn conversation_id required
- [ ] existing `--conversation` formal lifecycle 연결
- [ ] resume failure classification
- [ ] tests

### Bridge-4 — Prompt Pipeline Switch

- [ ] native continuation assembler
- [ ] handoff assembler
- [ ] legacy/recovery bootstrap assembler
- [ ] same-provider history injection 제거
- [ ] global memory policy 재정의
- [ ] Auto Compact normal hot path 제거
- [ ] canonical transcript 저장 유지

### Bridge-5 — `/new` & `/sessions` Native UX

- [ ] `/new` lazy UNBOUND mapping
- [ ] `/sessions` current Provider native list
- [ ] native session adopt/import
- [ ] mapped logical session 표시
- [ ] logical archive/trash와 native history UX 분리
- [ ] tests

### Bridge-6 — Provider Handoff Transaction

- [ ] first-target bootstrap
- [ ] existing-target delta
- [ ] sync cursor success-only update
- [ ] target execution 성공 후 active provider switch
- [ ] failure rollback
- [ ] Codex → Antigravity → Codex round-trip test

### Bridge-7 — Legacy Migration / Recovery

- [ ] V1 Codex no-ref one-time bootstrap
- [ ] existing Antigravity ref adopt
- [ ] MISSING recovery UX
- [ ] restart persistence
- [ ] backup/restore compatibility

### Bridge-8 — Regression / Live Validation / Closure

- [ ] full regression
- [ ] GitHub Actions success
- [ ] Telegram `/new` smoke
- [ ] Codex 3+ consecutive turns same native thread
- [ ] `/sessions` native list/adopt
- [ ] Codex → Antigravity bootstrap
- [ ] Antigravity → Codex delta return
- [ ] Agent Hub restart 후 resume
- [ ] timeout/cancel regression
- [ ] final architecture record update
- [ ] Status = `DONE`

---

## 18. Mandatory Live Scenarios

### Scenario A — Same Codex continuity

```text
/new
"작업 번호 1 완료를 기억해"
"작업 번호 2 완료를 기억해"
"완료된 번호를 말해줘"
```

검증:

- first turn `thread.started.thread_id` bind
- second/third turn same native ref resume
- summary/recent transcript reconstruction 없음
- 1/2 continuity 유지

### Scenario B — 실제 개발 진행률

단계 1~N 완료 후 “다음 단계 진행” 요청 시 summary 누락 때문에 과거 단계로 회귀하지 않아야 한다.

### Scenario C — Cross-provider bootstrap

Codex A → Antigravity A.

첫 Antigravity turn에만 bootstrap, 두 번째 turn부터 native conversation continuation.

### Scenario D — Round-trip delta

Codex A → Antigravity A에서 변경 → Codex A 복귀.

기존 Codex thread ID를 유지하고 Antigravity 구간 delta만 한 번 전달.

### Scenario E — Restart

Agent Hub 재배포 후 DB mapping의 native ref로 동일 native conversation resume.

---

## 19. Migration Safety

기존 V1 data를 파괴하지 않는다.

- sessions 유지
- messages 유지
- rolling summary 유지
- provider_handoffs 유지
- existing provider native refs 유지

Migration 015는 existing native ref를 READY로 승격하고 ref가 없는 mapping을 UNBOUND로 둔다.

기존 duplicate `(session_id, provider)` row가 있다면 자동 삭제/선택하지 않는다. Unique index 생성에서 migration을 실패시켜 pre-migration backup 상태에서 운영자가 명시적으로 확인하게 한다.

---

## 20. Non-goals

이번 Bridge에 포함하지 않는다.

- 기존 Phase 18 MCP/Skills 작업
- Provider native history 전체 DB 복제
- hidden reasoning/tool state의 lossless cross-provider migration
- native rename/delete 완전 통일
- Antigravity persistent stream-json worker 최적화
- timeout 무작정 증가
- canonical transcript 삭제

---

## 21. Definition of DONE

1. Codex/Antigravity same-provider normal turn이 native session을 사용한다.
2. same-provider normal turn에서 summary + recent transcript reconstruction을 사용하지 않는다.
3. `/new` logical/native lifecycle이 정상 동작한다.
4. `/sessions`가 active Provider native source를 사용한다.
5. Provider 전환 시에만 bootstrap/delta handoff가 사용된다.
6. Provider 왕복 후 각 Provider native identity가 유지된다.
7. V1 sessions/messages migration 데이터 손실이 없다.
8. Agent Hub restart 후 native mapping으로 resume한다.
9. missing native session을 silent fallback으로 숨기지 않는다.
10. 전체 regression CI가 성공한다.
11. Telegram/container live smoke가 성공한다.
12. 각 Bridge stage 구현/결정/검증이 이 문서에 기록된다.

---

## 22. Progress Log

### 2026-09-02 — Architecture baseline

Baseline main:

```text
cba7b8b042f27bf464c5a05cc4b160c559664eb4
```

결정:

- Phase 18과 분리한 `V1 → V2 Native Session Bridge`로 관리.
- Provider native session을 primary conversational memory로 승격.
- Agent Hub canonical messages는 transcript/audit/handoff/recovery source로 유지.
- same-provider turn에서 permanent context reconstruction을 제거하는 것을 핵심 목표로 확정.

Planning commit:

```text
8405f6ae1c666bf988f25fe653ff5b90094ccb29 docs: plan V1-V2 native session bridge
```

### 2026-09-02 — Codex live probe

실제 Agent Hub 컨테이너:

```text
codex-cli 0.149.1
```

확인:

- `codex exec resume [SESSION_ID] [PROMPT]`
- `codex exec resume --last`
- `codex exec --json`
- first event `thread.started`
- native identity field `thread_id`
- probe가 정상 `turn.completed`로 종료

Architecture decision:

```text
Codex nativeSessionRef = JSONL thread.started.thread_id
```

이 필드를 추측이나 local file scan보다 우선하는 canonical create-time source로 사용한다.

### 2026-09-02 — Bridge-1 foundation 구현

Implemented:

- `015_native_session_bridge.sql`
- `ProviderSessionRepository`
- ContextManager compatibility delegation
- native mapping lifecycle focused tests

Commits:

```text
6c39d5e33c1a7cd5cd829f57f913f3b07fce5f03 feat: add native session bridge schema
903434034bf5dadb20b8230206baecfb00755f00 feat: add provider native session repository
2faa145d60e38e01cbb0557da690e5e20e6337fe refactor: route provider session state through repository
d5b4e6c6625dc25b5d7ca1838ff2955dfb05abfb test: cover native session repository lifecycle
```

Draft PR:

```text
#7 bridge: migrate V1 conversations to provider-native sessions
```

Validation state:

```text
Focused test code committed
GitHub Actions: pending
Live DB migration: not yet deployed
```

Known open item:

- `/sessions` native source는 아직 확정하지 않았다. Create/resume 구현과 분리해서 Bridge-5 전에 반드시 확정한다.

---

## 23. Implementation Record Rule

각 Bridge stage가 끝날 때 이 파일을 갱신한다.

기록 항목:

```text
Status
Implemented
Commits
Unit / Integration tests
CI result
Live validation
Decisions changed from plan
Known limitations
```

이 파일은 완료 후 폐기하는 TODO가 아니라 **Agent Hub Core가 왜 V1 context reconstruction을 버리고 V2 native-session architecture로 넘어갔는지 남기는 architecture record**다.

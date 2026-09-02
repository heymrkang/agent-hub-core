# V1 → V2 Native Session Bridge

## Status

`PLANNED — architecture baseline 확정, live CLI contract probe 전`

이 문서는 Agent Hub Core가 V1의 **Agent Hub-owned context reconstruction**에서 V2의 **Provider-native session first** 구조로 넘어가는 전환 기록이다.

이번 작업은 Phase 18이 아니다. 이미 계획된 Phase 18(MCP/Skills)은 그대로 유지하며, 본 작업은 V1↔V2 사이의 architecture bridge로 관리한다.

상태는 구현과 함께 `PLANNED → IN_PROGRESS → LIVE_VALIDATION → DONE`으로 갱신한다.

---

## 1. Problem Statement

현재 일반 대화는 매 turn 다음 구조로 Provider prompt를 다시 만든다.

```text
Global Memory
+ rolling_summary
+ compact cursor 이후 최근 canonical messages
+ 현재 prompt
```

이 때문에 긴 작업에서 실제로 1~10까지 완료했더라도 summary/recent tail에 10 완료 사실이 없으면 다음 Provider 실행은 과거 단계로 회귀할 수 있다.

현재 코드 기준:

- `ContextAssembler`가 normal turn마다 summary + recent history를 조립한다.
- `QueueManager`는 이미 `provider_sessions.native_session_ref`를 adapter에 전달하고, result의 native ref를 다시 저장할 수 있다.
- `provider_sessions`와 `provider_handoffs` schema도 이미 존재한다.
- AntigravityAdapter는 `--conversation <id>`와 result `conversation_id`를 일부 연결하고 있다.
- CodexAdapter는 native resume capability를 PARTIAL로 표시하지만 일반 실행은 매번 새 `codex exec`다.

즉 새 개념을 만드는 것이 아니라 **V1에서 반쯤 존재하는 native-session mapping을 primary architecture로 승격**하는 작업이다.

---

## 2. Architecture Principle

> **Agent Hub Core는 대화를 소유하지 않는다. Provider native conversation을 연결하고 중계한다.**

권위 분리:

```text
Provider Native Session
= 실제 AI conversation continuity / primary conversational memory

Agent Hub Logical Session
= Telegram에서 사용자가 보는 작업 단위
= Provider별 native session을 묶는 identity

Agent Hub messages
= transcript / audit / handoff source / recovery evidence
= normal same-provider turn의 primary memory가 아님

rolling_summary + recent messages
= cross-provider handoff / legacy migration / explicit recovery 용도
= normal same-provider turn마다 재주입하지 않음
```

### 핵심 invariant

**같은 Provider native session이 정상적으로 존재하면 이전 chat transcript를 Agent Hub가 매 turn 재조립하지 않는다.**

정상:

```text
Logical A
Codex native abc123
User: "17-6-2 진행"
→ abc123 resume + 현재 요청
```

금지되는 정상 hot path:

```text
summary + 최근 대화 + 현재 요청
→ 새 codex exec
```

---

## 3. Logical Session / Provider Session

목표:

```text
Logical Session A
├─ codex
│  ├─ native_session_ref = abc123
│  ├─ last_synced_message_id = m42
│  └─ state = READY
└─ antigravity
   ├─ native_session_ref = xyz789
   ├─ last_synced_message_id = m57
   └─ state = READY
```

DB 역할:

- 사용자 ↔ Logical Session
- active Provider / Model / Thinking / Profile
- Logical Session ↔ Provider native session ref
- Provider별 canonical sync cursor
- handoff 이력
- Telegram transcript / attachments / jobs / audit

DB가 하지 않는 일:

- Provider가 이미 기억하는 전체 conversation을 매 요청마다 재현
- native session이 정상인데 rolling summary를 primary memory처럼 사용

---

## 4. Provider Native Session Contract

ProviderAdapter는 의미상 다음 기능을 제공해야 한다.

```text
startNativeSession(prompt, options)
resumeNativeSession(nativeSessionRef, prompt, options)
listNativeSessions(options)
getNativeSession(nativeSessionRef)
renameNativeSession?()
deleteNativeSession?()
```

최종 함수명은 구현 단계에서 조정 가능하지만 QueueManager/Telegram command가 Provider별 CLI syntax를 알아서는 안 된다.

공통 execute result 최소 계약:

```js
{
  response,
  nativeSessionRef,
  usage,
  nativeSessionCreated
}
```

새 native session을 만들었는데 ref를 확보하지 못하면 성공으로 가장하지 않는다.

---

## 5. Codex Native Session

Upstream Codex CLI에는 headless resume가 존재한다.

```text
codex exec resume <SESSION_ID> <PROMPT>
codex exec resume --last <PROMPT>
```

upstream code/test에서 UUID/session name resume와 JSON resume 경로가 확인된다.

### 새 세션

`/new`가 Provider API call까지 만들 필요는 없다. 기본안은 lazy binding이다.

```text
/new
→ 새 Logical Session (Codex mapping=UNBOUND)
→ 첫 user turn
→ resume ref 없이 codex exec
→ 새 native session ID capture
→ provider_sessions bind
```

### 후속 turn

```text
native ref 존재
→ codex exec resume <nativeSessionRef> <current prompt>
```

이때 normal rolling summary / recent transcript는 넣지 않는다.

### 실제 배포 CLI에서 반드시 probe

- `codex --version`
- `codex exec --help`
- `codex exec resume --help`
- 신규 `codex exec --json`의 session ID event/field
- native sessions 목록을 headless/structured 방식으로 얻는 방법
- 목록 API가 없을 때 local session store를 안전하게 읽을 수 있는지
- title/cwd/created_at metadata source

**TUI 화면 scraping 금지.** 구조화 output/event 또는 안정적 local state만 허용한다.

---

## 6. Antigravity Native Session

공식 CLI가 다음을 지원한다.

```text
agy --conversation <conversation-id>
agy -c / --continue
/resume
headless JSON conversation_id
```

현재 Adapter에도 일부 구현되어 있으므로 이를 formal native-session contract로 승격한다.

새 세션은 Codex와 동일하게 lazy binding:

```text
Logical Session 생성
→ 첫 prompt를 --conversation 없이 실행
→ result conversation_id 저장
```

후속 turn:

```text
agy --print <current prompt> --conversation <conversation-id>
```

공식 headless mode의 persistent `stream-json` multi-turn은 성능 최적화 후보지만 Bridge 1차 목표에서는 제외한다. 우선 correctness를 확보한다.

---

## 7. `/new`

V1:

```text
/new → Agent Hub DB session → 매 turn reconstructed context
```

Bridge 이후:

```text
/new
→ 새 Logical Session
→ 기본 Provider/model/profile 설정
→ Provider mapping=UNBOUND
→ 첫 user turn 성공 후 native ref bind
```

UI는 "Native Session: 첫 메시지에서 생성" 같은 상태를 표현할 수 있어야 한다.

---

## 8. `/sessions`

핵심 결정:

```text
현재 Provider=Codex
/sessions → Codex native sessions

현재 Provider=Antigravity
/sessions → Antigravity native conversations
```

CLI에서 직접 만든 native session도 선택 가능해야 한다.

mapping이 없는 native session 선택:

```text
native session 선택
→ Logical Session adopt/import
→ provider_sessions mapping 생성
→ active logical session 설정
```

### 기존 archive/trash UX

Native session이 source-of-truth가 되면 Agent Hub logical archive/trash와 Provider native delete는 같은 의미가 아니다.

Bridge 첫 버전 원칙:

- `/sessions` primary list = current Provider native sessions
- logical transcript archive/delete와 native delete 분리
- native delete capability가 검증되기 전 자동 native deletion 금지
- purge 버튼 하나로 Agent Hub transcript와 Provider history를 동시에 삭제하지 않음

---

## 9. `/model` Provider Handoff

### Same Provider model 변경

native session identity 유지. Provider가 existing conversation에서 model change를 허용하면 resume 시 target model 전달. 불가하면 명확히 오류 처리하고 몰래 새 session을 만들지 않는다.

### Codex → Antigravity 최초 전환

```text
Logical A / Codex native abc123
Antigravity mapping 없음
↓
canonical transcript에서 handoff bootstrap 생성
↓
Antigravity 첫 turn에 1회 포함
↓
conversation_id xyz789 확보
↓
Logical A ↔ Antigravity xyz789 bind
↓
last_synced_message_id 갱신
```

### 기존 target session으로 복귀

```text
Codex A가 m80까지 알고 있음
Antigravity A가 m57까지 알고 있음
↓
Antigravity로 복귀
↓
m58~m80 canonical delta + 현재 요청을 existing xyz789에 1회 전달
↓
성공 후 Antigravity sync cursor=m80 이후 latest
```

즉 Provider 왕복 시 새 target conversation을 만들지 않고 **provider-specific delta handoff**를 한다.

### 손실 정책

Cross-provider에서는 hidden reasoning/tool state 등 100% 이동이 불가능할 수 있다.

목표는:

```text
Same Provider → native continuity 최대 보존
Cross Provider → canonical delta 기반 best-effort handoff
```

---

## 10. ContextAssembler 역할 축소

세 경로로 분리한다.

### Native continuation

현재 prompt + 필요한 최소 global memory/instruction만 전달. 과거 chat transcript 주입 금지.

### Provider handoff

`rolling summary + target Provider가 아직 모르는 canonical messages + current prompt` 사용.

### Legacy/recovery

기존 V1 session 또는 명시적 recovery에서만 reconstructed context를 1회 bootstrap으로 사용.

native ref가 있는데 session not found가 발생했을 때 자동 새 conversation + silent reconstruction은 금지한다. mapping을 `MISSING/ERROR`로 기록하고 recovery를 명시적으로 진행한다.

---

## 11. Compact의 새로운 위치

V1 compact는 normal Provider prompt 크기를 줄이는 핵심 기능이었지만 native-session first에서는 hot path에서 제외한다.

기존 compact state는 삭제하지 않는다.

용도:

- cross-provider handoff summary
- legacy V1 bootstrap
- broken native session recovery
- audit/history summary

Provider native compact가 안정적으로 노출되면 V2 이후 별도 재정의한다.

---

## 12. Schema / Migration

현재 `provider_sessions` 확장을 우선한다.

후보:

```text
native_session_ref        existing
last_synced_message_id    existing
state                     UNBOUND / READY / MISSING / ERROR
bound_at
last_verified_at
last_error
metadata_json
```

추가 invariant 후보:

```text
UNIQUE(session_id, provider)
```

현재 schema는 index만 있고 DB-level unique constraint는 없으므로 migration에서 보강한다.

Migration 원칙:

- 기존 V1 sessions/messages 삭제 금지
- existing native ref 보존
- ref 없는 row는 UNBOUND
- 기존 Antigravity ref는 resume live validation
- 기존 Codex logical session에 임의 native session 자동 매핑 금지
- ambiguous mapping 추측 금지

---

## 13. Legacy V1 Compatibility

### 기존 Codex logical session / ref 없음

첫 사용 시 딱 한 번 legacy bootstrap 허용:

```text
canonical summary/history
→ 새 Codex native session 1회 bootstrap
→ native ref 저장
→ 이후 native-only continuation
```

즉 V1 reconstruction을 permanent runtime 방식이 아니라 migration tool로 격하시킨다.

### 기존 Antigravity ref

실제 resume되면 그대로 adopt. 실패하면 MISSING으로 표시하고 mapping을 몰래 교체하지 않는다.

---

## 14. Failure / Transaction Semantics

### native resume 실패

금지:

```text
resume 실패 → 몰래 새 session → full history 재주입 → 정상처럼 응답
```

대신:

```text
resume 실패
→ mapping state=MISSING/ERROR
→ 명확한 job failure
→ explicit recovery 가능
```

### provider handoff 실패

현재 HandoffManager는 target Provider 선택을 먼저 저장하고 실제 sync를 다음 execution에 미룬다. V2에서는 순서를 바꾼다.

목표:

```text
target prepare
→ target native turn/bootstrap 성공
→ native ref/cursor 저장
→ active_provider switch commit
```

실패하면 기존 Provider/native session 유지.

### secrets/logging

- prompt/history 전체 operational logging 금지
- handoff payload secret redaction
- existing CLI diagnostic redaction 유지
- native ref는 로그에 short ref만 사용

---

## 15. Queue / Concurrency

Serialization key는 계속 Logical Session.

같은 Logical A에서 Codex/Antigravity turn이 동시에 진행되면 sync cursor와 handoff ordering이 깨질 수 있으므로:

```text
Logical Session A
→ state-mutating conversational job 최대 1개
```

Provider global concurrency limit은 기존대로 유지.

`/model`, session adopt, recovery 등 mapping 변경 command는 동일 logical session active job과 충돌하지 않도록 guard한다.

---

## 16. Rename / Delete

Logical title과 Provider native title은 분리한다.

- Agent Hub logical rename은 가능
- native rename은 capability 확인 후 선택적 sync
- logical transcript delete와 Provider native history delete는 별도 행위
- Bridge 첫 버전에서는 native history 자동 삭제 금지

---

## 17. Observability

prompt/secret 없이 다음 수준 로그를 남긴다.

```text
[NativeSession] create provider=codex logical=<id> native=<short>
[NativeSession] resume provider=codex logical=<id> native=<short>
[NativeSession] handoff codex→antigravity logical=<id> delta_messages=N
[NativeSession] adopted provider=antigravity logical=<id> native=<short>
[NativeSession] missing provider=codex logical=<id> native=<short>
```

운영 목표:

- same-provider normal turn reconstruction fallback = 0
- native create/resume 성공률 확인
- legacy bootstrap 횟수 추적
- handoff delta 크기 추적
- missing/recovery 횟수 추적

---

## 18. Bridge Work Stages

Phase 번호를 사용하지 않는다.

### Bridge-0 — Design & Live Capability Probe

Status: `IN PROGRESS`

- [x] V1 실행 구조 조사
- [x] provider_sessions/handoff 조사
- [x] Codex upstream exec resume 확인
- [x] Antigravity native conversation 공식 기능 확인
- [ ] 실제 배포 Codex CLI probe
- [ ] 필요 시 Antigravity live probe
- [ ] native session list source 확정
- [ ] new session ID capture source 확정

Exit: 두 Provider의 create/resume/id/list contract를 추측 없이 확정.

### Bridge-1 — Native Session Repository & Schema

- [ ] provider_sessions migration
- [ ] mapping invariant
- [ ] state/bound/verify/error metadata
- [ ] repository/service boundary
- [ ] legacy migration tests

### Bridge-2 — Codex Native Create/Resume

- [ ] new session ID capture
- [ ] exec resume <id>
- [ ] FULL_ACCESS
- [ ] restricted helper native store persistence
- [ ] timeout/cancel telemetry 유지
- [ ] session-not-found classification
- [ ] tests

Exit: Codex 두 번째 turn부터 reconstructed history 없이 native resume.

### Bridge-3 — Antigravity Native Create/Resume Hardening

- [ ] existing --conversation formal contract
- [ ] first-turn conversation_id required
- [ ] resume failure classification
- [ ] workspace scoping
- [ ] tests

### Bridge-4 — Prompt Pipeline Switch

- [ ] native continuation / handoff / legacy recovery assembler 분리
- [ ] normal same-provider history injection 제거
- [ ] global memory policy 분리
- [ ] Auto Compact hot path 제거
- [ ] transcript 저장 유지

### Bridge-5 — `/new` & `/sessions` Native UX

- [ ] /new lazy native binding
- [ ] /sessions current Provider native list
- [ ] native session adopt/import
- [ ] mapped logical session 표시
- [ ] archive/trash UX 충돌 정리
- [ ] tests

### Bridge-6 — Provider Handoff Transaction

- [ ] first-target bootstrap
- [ ] existing-target delta
- [ ] sync cursor success-only update
- [ ] target execution 성공 후 provider switch
- [ ] failure rollback
- [ ] Codex→Antigravity→Codex round-trip test

### Bridge-7 — Legacy Migration / Recovery

- [ ] V1 Codex no-ref 1회 bootstrap
- [ ] existing Antigravity ref adopt
- [ ] MISSING recovery UX
- [ ] backup/restore compatibility
- [ ] restart persistence

### Bridge-8 — Regression / Live Validation / Closure

- [ ] full npm test
- [ ] GitHub Actions success
- [ ] Telegram /new smoke
- [ ] 3+ consecutive Codex turns continuity
- [ ] /sessions native list/adopt
- [ ] Codex→Antigravity handoff
- [ ] Antigravity→Codex delta return
- [ ] restart 후 native resume
- [ ] timeout/cancel regression
- [ ] 문서 final update
- [ ] Status=DONE

---

## 19. Mandatory Live Scenarios

### A. Codex continuity

```text
/new
"작업 번호 1 완료를 기억해"
"작업 번호 2 완료를 기억해"
"완료된 번호를 말해줘"
```

검증: same native ref resume, reconstructed history 없음, 1/2 continuity 유지.

### B. Real coding progress

단계 1~N 완료 후 "다음 단계 진행" 시 summary 누락 때문에 과거 단계로 회귀하지 않음.

### C. Cross-provider bootstrap

Codex A → Antigravity. 첫 Antigravity turn에만 bootstrap. 두 번째 Antigravity turn부터 bootstrap 없음.

### D. Round-trip delta

Codex A → Antigravity A에서 변경 → Codex A 복귀. 기존 Codex native ref 재사용 + Antigravity 구간 delta 1회.

### E. Restart

Agent Hub 재배포 후 DB mapping의 native ref로 동일 Provider session resume.

---

## 20. Non-goals

- Phase 18 MCP/Skills 흡수
- Provider native history DB 완전 복제
- hidden reasoning/tool state lossless cross-provider migration
- native delete/rename 완전 통일
- Antigravity persistent stream-json worker 최적화
- timeout 무작정 증가
- canonical transcript 삭제

---

## 21. Definition of DONE

1. Codex/Antigravity same-provider normal turn이 native session 사용.
2. same-provider normal turn에서 summary + recent reconstruction 미사용.
3. `/new` logical/native lifecycle 정상.
4. `/sessions` active Provider native source 사용.
5. Provider 전환 시에만 bootstrap/delta handoff.
6. Provider 왕복 후 각 native identity 유지.
7. V1 sessions/messages migration 데이터 손실 없음.
8. restart 후 mapping 유지/resume.
9. missing native session을 silent fallback으로 숨기지 않음.
10. 전체 regression CI 성공.
11. Telegram/container live smoke 성공.
12. 각 Bridge stage의 commit/검증 결과가 이 문서에 기록됨.

---

## 22. Progress Log

### 2026-09-02 — Bridge planning 시작

- 이번 작업을 Phase 18이 아닌 `V1 → V2 Native Session Bridge`로 분리.
- baseline main: `cba7b8b042f27bf464c5a05cc4b160c559664eb4`.
- V1 code audit:
  - ContextAssembler가 normal turn마다 rolling summary + recent canonical messages 주입.
  - provider_sessions + last_synced_message_id 이미 존재.
  - QueueManager가 nativeSessionRef 전달/저장 경로 보유.
  - AntigravityAdapter native resume 부분 구현.
  - CodexAdapter native resume 미연결.
  - 현재 HandoffManager는 target provider를 먼저 저장하고 sync를 다음 execution으로 미룸.
- Upstream capability:
  - Codex exec resume 확인.
  - Antigravity --conversation / resume / headless conversation_id 확인.
- 다음: 실제 배포 Codex CLI에서 native ID/list contract live probe 후 Bridge-1 착수.

---

## 23. Implementation Record Template

각 stage 완료 시 이 문서에 다음을 추가한다.

```text
### YYYY-MM-DD — Bridge-N 완료
Status: DONE
Implemented:
- ...
Commits:
- <sha> <message>
Tests:
- Unit: ...
- Integration: ...
- CI: ...
- Live: ...
Decisions changed from plan:
- ...
Known limitations:
- ...
```

이 파일은 완료 후 버리는 TODO가 아니라 **V1에서 V2로 넘어간 이유, 선택, 실패, 검증을 남기는 architecture record**다.

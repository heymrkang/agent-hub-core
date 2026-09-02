# V1 → V2 Native Session Bridge

## Status

`LIVE_VALIDATION — native continuity 구현 완료, Logical Session-first UX 교정 중`

이 문서는 Agent Hub Core가 V1의 **Agent Hub-owned context reconstruction**에서 V2의 **Provider-native session first** 구조로 넘어간 과정을 기록한다.

이번 작업은 기존 Phase 18과 별개인 V1↔V2 architecture bridge다. Phase 18 계획은 그대로 유지한다.

상태 흐름:

```text
PLANNED → IN_PROGRESS → LIVE_VALIDATION → DONE
```

현재는 코드/CI 수준의 native-session 전환은 완료됐고, Telegram 실사용 검증에서 발견된 session UX 결함을 수정하는 단계다.

---

## 1. Architecture Principle

> **Agent Hub Core는 대화를 소유하지 않는다. Provider native conversation을 연결하고 중계한다.**

단, 사용자가 선택하는 작업 단위의 authority는 **Agent Hub Logical Session**이다.

```text
Agent Hub Logical Session A
├─ Codex native thread A
└─ Antigravity native conversation A
```

역할 분리:

```text
Provider Native Session
= 실제 AI conversation continuity
= same-provider primary conversational memory

Agent Hub Logical Session
= Telegram에서 사용자가 선택하는 작업/대화 단위
= Provider별 native identity를 묶는 bridge key

Agent Hub messages
= transcript / audit / provider handoff / recovery evidence
= same-provider normal turn의 primary memory가 아님

rolling_summary + recent canonical messages
= cross-provider handoff / legacy bootstrap / recovery 용도
= same-provider normal turn마다 재주입하지 않음
```

### 핵심 invariant

```text
/sessions
→ 항상 Agent Hub Logical Session을 선택한다.

/model
→ 현재 Logical Session 안에서 Provider를 바꾼다.

same-provider turn
→ 해당 Logical Session에 매핑된 native session을 resume한다.
```

---

## 2. V1 문제

V1 일반 대화는 매 요청마다 다음 형태로 Provider prompt를 재구성했다.

```text
Global Memory
+ rolling_summary
+ 최근 canonical messages
+ 현재 prompt
```

이 방식에서는 실제 Provider conversation에서 작업 1~10이 끝났어도 Agent Hub summary/recent tail에 4~10 완료 사실이 없으면 다음 요청에서 과거 단계로 회귀할 수 있다.

Bridge의 핵심 목적은 이 문제를 없애는 것이다.

---

## 3. Target Mapping

```text
Logical Session A
├─ codex
│  ├─ native_session_ref = <thread-id>
│  ├─ state = READY
│  └─ last_synced_message_id = <cursor>
└─ antigravity
   ├─ native_session_ref = <conversation-id>
   ├─ state = READY
   └─ last_synced_message_id = <cursor>
```

Lifecycle state:

```text
UNBOUND
  Logical Session은 존재하지만 해당 Provider native identity는 아직 없음

READY
  native_session_ref가 있고 continuation 가능

MISSING
  저장된 native ref를 Provider에서 찾을 수 없음

ERROR
  native mapping 오류 발생
```

DB invariant:

```text
UNIQUE(session_id, provider)
UNIQUE(provider, native_session_ref) WHERE native_session_ref IS NOT NULL
```

한 native conversation을 서로 다른 Logical Session에 중복 연결하지 않는다.

---

## 4. Codex Live Contract

2026-09-02 Agent Hub 컨테이너에서 확인:

```text
codex-cli 0.149.1
```

새 session:

```text
codex exec --json <prompt>
```

실제 첫 event:

```json
{"type":"thread.started","thread_id":"<UUID>"}
```

따라서 Codex canonical native identity:

```text
nativeSessionRef = thread.started.thread_id
```

resume:

```text
codex exec resume <SESSION_ID> <PROMPT>
```

Bridge 동작:

```text
UNBOUND
→ codex exec --json
→ thread.started.thread_id capture
→ READY bind

READY
→ codex exec resume <thread_id> <current prompt>
```

`--ephemeral`은 사용하지 않는다.

---

## 5. Antigravity Live Contract

2026-09-02 Agent Hub 컨테이너에서 확인:

```text
agy 1.1.24
```

resume:

```text
agy --conversation <conversation-id>
agy --continue
```

headless JSON 결과에서 `conversation_id`를 native identity로 사용한다.

확인된 제약:

```text
agy --print /resume --output-format json
→ ERROR
→ /resume picker is not available in print mode
```

즉 Antigravity는 현재 headless 환경에서 native conversation 전체 목록 picker/list API를 제공하지 않는다.

이 제약은 native create/resume 자체에는 문제가 없지만 `/sessions` UX 설계에 영향을 줬다.

---

## 6. Prompt Routing

### Native continuation

Provider mapping이 READY면:

```text
Global Memory (현재 정책 범위)
+ current prompt
```

과거 chat transcript를 매번 재주입하지 않는다.

Runtime log 예:

```text
Context:NATIVE_CONTINUATION
```

### Provider switch / return

Target Provider가 아직 모르는 다른 Provider 구간만 delta로 전달한다.

```text
[Provider Handoff Delta]
+ target Provider cursor 이후 다른 Provider가 수행한 user/assistant messages
+ current prompt
```

Runtime log:

```text
Context:NATIVE_DELTA
```

### UNBOUND / legacy bootstrap

native ref가 아직 없는 경우에만 canonical context reconstruction을 1회 사용한다.

```text
Context:BOOTSTRAP
```

첫 native ref가 bind된 뒤에는 같은 Provider에서 native continuation으로 전환한다.

---

## 7. `/new`

```text
/new
→ 새 Agent Hub Logical Session
→ 현재/default Provider mapping UNBOUND
→ 첫 user turn
→ Provider native session 생성
→ native ref READY bind
```

Native session을 미리 억지로 만들지 않는 lazy binding 방식이다.

---

## 8. `/sessions` — Final Authority Decision

### 초기 Bridge 설계

처음에는 다음 UX를 구현했다.

```text
Codex selected
/sessions → Codex native thread/list

Antigravity selected
/sessions → Agent Hub가 알고 있는 Antigravity READY mappings
```

Codex는 app-server `thread/list`를 사용할 수 있어 실제 provider-native 목록을 노출했고, mapping이 없는 thread는 Agent Hub Logical Session으로 adopt할 수 있게 했다.

### Live validation에서 발견된 문제

2026-09-02 실제 Telegram 테스트에서 이 설계가 사용자 관점의 session identity를 흔든다는 것이 확인됐다.

문제:

```text
같은 /sessions 명령인데
Codex에서는 Provider-native thread 목록
Antigravity에서는 Agent Hub mapped subset
```

Provider를 오갈 때 사용자는 "Agent Hub Session A"가 아니라 서로 다른 Provider-native 목록을 직접 골라야 했다.

특히 Codex의 unmapped native thread를 선택하면 새 Logical Session을 adopt하는 동작 때문에, 사용자가 의도한 기존 Logical Session A와 다른 Logical Session을 선택할 수 있다.

Live symptom:

```text
재시작 후 "777" 기억 테스트에서 기대한 Codex continuity를 확인하지 못함
```

이 시점에서는 native persistence 실패와 잘못된 native thread 선택을 UI상 명확히 구분할 수 없었다.

### 최종 결정

`/sessions`의 authority를 **Agent Hub Logical Session**으로 되돌린다.

```text
/sessions
→ Provider와 무관하게 Agent Hub Logical Sessions A/B/C

Session A 선택
→ active logical session = A

/model Codex
→ A.codex native mapping 사용

/model Antigravity
→ A.antigravity native mapping 사용
```

Provider native list/adopt는 메인 `/sessions` UX에서 제거한다.

이 결정은 native conversation을 primary AI memory로 사용한다는 원칙과 충돌하지 않는다.

```text
사용자가 선택하는 identity = Logical Session
AI가 기억하는 identity = Provider Native Session
```

이 두 역할을 분리하는 것이 최종 V2 구조다.

---

## 9. `/model` Provider Handoff

Logical Session A가 Codex에서 시작했다고 가정:

```text
A.codex = READY abc123
A.antigravity = UNBOUND
```

Codex → Antigravity:

```text
/model Antigravity
→ Logical Session A 유지
→ A.antigravity가 UNBOUND면 첫 target execution에 bootstrap
→ conversation_id 확보
→ A.antigravity READY
```

Antigravity에서 작업 후 다시 Codex:

```text
/model Codex
→ Logical Session A 유지
→ A.codex abc123 resume
→ Codex가 놓친 Antigravity delta만 1회 전달
```

Provider switch가 Logical Session switch를 의미하지 않는다.

---

## 10. Failure Semantics

금지:

```text
native resume 실패
→ 몰래 새 native session 생성
→ full history 재주입
→ 정상 continuation처럼 반환
```

원칙:

```text
resume 실패
→ MISSING 또는 ERROR
→ 명확한 failure
→ explicit recovery
```

Logical Session purge도 Provider native history를 자동 삭제하지 않는다.

---

## 11. Observability

native ref는 전체를 로그에 노출하지 않고 short ref로 남긴다.

예:

```text
[Sessions] logical switch: user=<id> session=<logical-id> active_provider=codex mappings=codex:READY:01a061db…e1be,antigravity:READY:abc…xyz

[NativeSession] handoff logical=<logical-id> codex(READY:<short>) -> antigravity(READY:<short>) messages=N
```

이 로그의 목적:

- 현재 선택된 Logical Session 확인
- Provider별 mapping state 확인
- 예상 native ref가 실제로 유지되는지 확인
- restart/handoff continuity 문제를 즉시 분류

---

## 12. Implemented Components

### Schema / repository

- `015_native_session_bridge.sql`
- Provider lifecycle metadata
- Logical Session/provider unique invariant
- Provider/native-ref ownership invariant
- `ProviderSessionRepository`

### Codex

- JSONL parser
- `thread.started.thread_id` capture
- native create
- `codex exec resume <thread_id>`
- thread mismatch guard
- missing ref guard
- existing timeout telemetry 유지

### Antigravity

- `conversation_id` required for native creation
- `--conversation <id>` resume
- structured-response failure guard

### Context routing

- same-provider native continuation
- cross-provider delta handoff
- bootstrap fallback only when native ref 없음
- same-provider normal-turn history reconstruction 제거

### Session UX

- `/new` Logical Session + lazy native binding
- `/sessions` Logical Session-first (live validation correction)
- Provider native mapping 상태 상세 표시
- stale `native_*` callback compatibility
- direct native adopt from `/sessions` disabled

---

## 13. CI / PR Record

### Original Bridge

PR:

```text
#7 bridge: migrate V1 conversations to provider-native sessions
```

Final Bridge main SHA:

```text
f4452c95850f102a251fa2b1ad22526c3e6e13c7
```

GitHub Actions regression: SUCCESS.

### Native callback routing hotfix

Live bug:

```text
native_page/native_map/native_pick buttons were emitted
but top-level Telegram router only dispatched session_* callbacks
```

PR:

```text
#8 fix: route native session callbacks
```

Main SHA:

```text
f4dd25789aea5cfff9d2cfd081de1211cb66efd6
```

Regression: SUCCESS.

### Logical Session-first correction

Trigger:

```text
Live validation test #14 failed and exposed ambiguous session authority.
```

Changes:

- `/sessions` no longer lists Codex provider-native threads as primary choices
- `/sessions` always lists Agent Hub Logical Sessions
- each Logical Session displays Provider native mapping state
- native direct-adopt from stale `/sessions` buttons is blocked
- session switch / provider handoff mapping logs added
- focused Logical Session UI regression tests added

Status:

```text
Implementation in progress
CI pending
Live re-validation pending
```

---

## 14. Live Validation Record

### Passed before UX correction

1. Deployment / command smoke
2. `/new` Codex session creation
3. same Codex session remembers `777`
4. repeated Codex native continuation remembers completed steps 1~3

Runtime confirmed:

```text
first turn  → Context:BOOTSTRAP
later turns → Context:NATIVE_CONTINUATION
```

This is strong evidence that same-provider Codex native create/resume works before restart.

### Bug found during `/sessions`

Buttons initially did nothing because `native_*` callbacks were not routed.

Fixed in PR #8 and regression passed.

### Test #14 failure

After Provider switching/restart flow, selecting a Codex entry and asking for the original `777` did not return the expected value.

At this point root cause is **not yet classified as native persistence failure** because the old `/sessions` UX could select/adopt a different Codex native thread than the Logical Session the user intended.

Therefore:

```text
Test #14 = INVALIDATED BY SESSION UX AMBIGUITY
```

It must be repeated after Logical Session-first `/sessions` is deployed.

---

## 15. Revised Mandatory Live Scenarios

### A. Same-provider continuity

```text
/new
"777을 기억해"
"아까 숫자가 뭐였지?"
```

Expected:

```text
first turn BOOTSTRAP
second turn NATIVE_CONTINUATION
answer = 777
```

### B. Logical Session switch

```text
Session A: remember 777
/new → Session B
/sessions → Session A 선택
"기억하라고 한 숫자?"
```

Expected:

```text
/sessions shows Agent Hub Session A/B
selecting A restores A
A.codex native ref is resumed
answer = 777
```

### C. Cross-provider round trip

```text
Session A / Codex → remember 777
/model Antigravity
Antigravity → remember 888
/model Codex
```

Expected:

```text
Logical Session remains A throughout
A.codex ref unchanged
A.antigravity ref unchanged after first bind
Codex receives Antigravity delta
```

### D. Restart persistence

```text
Session A has:
A.codex READY
A.antigravity READY

Agent Hub restart/redeploy
/sessions → Session A
/model Codex
ask remembered data
/model Antigravity
ask remembered data
```

Expected:

```text
same Logical Session A
same provider native refs
native continuation after restart
```

### E. Real development workflow

5~10 turns of actual implementation work must continue without reverting to old completed steps due to Agent Hub summary truncation.

---

## 16. Definition of DONE

Bridge is `DONE` only when all conditions are satisfied:

1. Codex same-provider normal turns use the same native thread.
2. Antigravity same-provider normal turns use the same native conversation.
3. same-provider normal turns do not reconstruct summary + recent transcript.
4. `/new` creates a Logical Session and lazily binds Provider native identity.
5. `/sessions` always selects Agent Hub Logical Sessions.
6. one Logical Session can hold independent Codex and Antigravity native mappings.
7. `/model` switches Provider inside the same Logical Session.
8. cross-provider return uses delta handoff rather than rebuilding every turn.
9. restart/redeploy preserves Logical Session → Provider native mapping continuity.
10. missing native sessions do not silently fall back to a new blank session.
11. full regression CI succeeds.
12. mandatory Telegram live scenarios succeed.
13. this architecture record is updated with final live results.
14. Status is changed to `DONE`.

---

## 17. Final V2 Promotion

Bridge `DONE` 이후 별도 정식 승격 작업으로 진행한다.

Planned promotion:

- source/UI의 legacy `V1` branding 정리
- Agent Hub Core version → `2.0.0`
- README / help / startup banner / package metadata 정리
- V2 architecture 기준 문서 최신화

Bridge 검증 전에는 version branding만 먼저 바꾸지 않는다.

---

## 18. Historical Decision Summary

### Kept

- Provider native conversation = primary AI continuity
- Agent Hub canonical transcript = audit/handoff/recovery
- provider-switch delta handoff
- lazy native binding
- native identity persistence in DB

### Changed after live validation

Initial idea:

```text
/sessions = current Provider native session picker
```

Final decision:

```text
/sessions = Agent Hub Logical Session picker
Provider native sessions = internal mappings under that Logical Session
```

Reason:

> Provider-native memory should be invisible infrastructure for continuity, not the user-facing identity of an Agent Hub conversation.

이 변경은 Bridge의 원칙을 약화한 것이 아니라, **Logical Session과 Provider Native Session의 책임을 더 정확히 분리한 것**이다.

# V1 → V2 Native Session Bridge

## Status

`DONE — Agent Hub Core V2 / 2.0.0 promotion approved after clean-state live validation`

이 문서는 Agent Hub Core가 V1의 **Agent Hub-owned context reconstruction**에서 V2의 **Provider-native session first** 구조로 전환한 최종 architecture/validation 기록이다.

상태 흐름:

```text
PLANNED → IN_PROGRESS → LIVE_VALIDATION → DONE
```

2026-09-03 기준 Bridge와 Provider-native Rules Memory는 구현·회귀 테스트·실환경 검증을 완료했고, 사용자의 최종 승인에 따라 V2 release blocker에서 해제했다.

---

## 1. Final Architecture Principle

> **Agent Hub Core는 대화를 소유하지 않는다. Provider native conversation을 연결하고 중계한다.**

사용자가 다루는 identity는 **Agent Hub Logical Session**, 실제 AI conversational continuity는 **Provider Native Session**이다.

```text
Agent Hub Logical Session A
├─ Codex native thread A
└─ Antigravity native conversation A
```

역할 분리:

```text
Agent Hub Logical Session
= Telegram에서 사용자가 선택하는 작업/대화 단위
= Provider별 native identity를 묶는 bridge key

Provider Native Session
= 실제 AI conversation continuity
= same-provider primary conversational memory

Agent Hub messages
= transcript / audit / provider handoff / recovery evidence
= same-provider normal turn의 primary memory가 아님

Agent Hub Global Memory
= 장기 사용자 규칙의 canonical source
= /data/memory/MEMORY.md

Provider Native Rules
= Global Memory의 실행 mirror
= Codex: $CODEX_HOME/AGENTS.md
= Antigravity: ~/.gemini/GEMINI.md
```

핵심 invariant:

```text
/sessions
→ 항상 Agent Hub Logical Session을 선택한다.

/model
→ 현재 Logical Session 안에서 Provider를 바꾼다.

same-provider turn
→ 현재 Logical Session에 매핑된 native session을 resume한다.

/memory
→ Agent Hub canonical memory를 수정한다.
→ Codex/Antigravity native Rules에 동일한 managed block을 동기화한다.
→ normal prompt에는 Global Memory를 매 turn 붙이지 않는다.
```

---

## 2. Why V1 Had To Change

V1 일반 대화는 매 요청마다 다음 형태로 prompt를 재구성했다.

```text
Global Memory
+ rolling_summary
+ 최근 canonical messages
+ 현재 prompt
```

이 구조에서는 Provider가 실제로 기억하고 있는 작업 진행 상태보다 Agent Hub가 재구성한 summary/recent tail이 우선되면서, 긴 실제 작업에서 완료한 단계가 누락되거나 과거 상태로 회귀할 수 있었다.

또한 `/memory`를 매 turn prompt에 주입하는 방식은 Codex/Antigravity가 자체적으로 제공하는 persistent Rules 기능과 역할이 중복됐다.

V2는 conversation continuity와 global instructions 모두에서 **Provider native capability를 우선 사용**하도록 authority를 재배치했다.

---

## 3. Provider Native Session Mapping

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

Lifecycle:

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

## 4. Confirmed Provider Contracts

### Codex

실환경에서 확인한 CLI:

```text
codex-cli 0.149.1
```

Create:

```text
codex exec --json <prompt>
```

첫 JSONL event의 `thread.started.thread_id`를 canonical native identity로 저장한다.

Resume:

```text
codex exec resume <thread_id> <current prompt>
```

Global Rules mirror:

```text
$CODEX_HOME/AGENTS.md
```

### Antigravity

실환경에서 확인한 CLI contract:

```text
agy --conversation <conversation-id>
agy --continue
```

headless structured result의 `conversation_id`를 native identity로 사용한다.

`agy --print /resume --output-format json`의 picker는 print mode에서 사용할 수 없으므로 `/sessions` authority를 Provider-native picker에 의존하지 않는다.

Global Rules mirror:

```text
~/.gemini/GEMINI.md
```

---

## 5. Prompt Routing

### Native continuation

Provider mapping이 READY면 normal same-provider turn은:

```text
current prompt
```

만 전달한다.

과거 canonical transcript와 Global Memory를 매번 재주입하지 않는다.

Runtime:

```text
Context:NATIVE_CONTINUATION
```

### Cross-provider handoff

Target Provider가 놓친 다른 Provider 구간만 전달한다.

```text
[Provider Handoff Delta]
+ target Provider cursor 이후 다른 Provider가 수행한 user/assistant messages
+ current prompt
```

Runtime:

```text
Context:NATIVE_DELTA
```

### First native bind / legacy bootstrap

native ref가 아직 없을 때만 canonical context reconstruction을 1회 사용한다.

```text
Context:BOOTSTRAP
```

Global Memory는 bootstrap에서도 별도 prompt block으로 중복 주입하지 않는다. Provider native Rules가 전역 지침을 공급한다.

---

## 6. `/new`, `/sessions`, `/model`

### `/new`

```text
/new
→ 새 Agent Hub Logical Session
→ 현재/default Provider mapping UNBOUND
→ 첫 user turn
→ Provider native session 생성
→ native ref READY bind
```

lazy binding 방식이다.

### `/sessions`

최종 authority:

```text
/sessions
→ Agent Hub Logical Session A/B/C
```

초기 Bridge에서 Codex native thread list를 직접 노출했던 설계는 live validation에서 session identity ambiguity를 만들었으므로 폐기했다.

현재는 사용자가 Logical Session만 선택하며 Provider native mappings는 해당 Logical Session의 내부 infrastructure다.

### `/model`

Provider switch는 Logical Session switch가 아니다.

```text
Session A / Codex
→ /model Antigravity
→ Session A 유지
→ A.antigravity bind/resume

→ /model Codex
→ Session A 유지
→ A.codex 기존 thread resume
→ Codex가 놓친 Antigravity delta만 전달
```

---

## 7. Provider-native Rules Memory

Canonical source:

```text
/data/memory/MEMORY.md
```

Mirror targets:

```text
Codex       → $CODEX_HOME/AGENTS.md
Antigravity → ~/.gemini/GEMINI.md
```

Managed block:

```text
<!-- AGENT_HUB_MEMORY_START -->
<canonical memory>
<!-- AGENT_HUB_MEMORY_END -->
```

최종 정책:

- Provider Rules 파일의 기존 사용자 작성 내용은 보존한다.
- Agent Hub는 marker 사이만 관리한다.
- `/memory <내용>`은 add shorthand다.
- `/memory add`, `/memory set`, `/memory clear`를 유지한다.
- 모든 mutation 성공 시 두 Provider Rules를 동기화한다.
- startup에서도 canonical memory로 두 Provider Rules를 재동기화한다.
- Provider Rules write가 부분 실패하면 가능한 범위에서 rollback하고 command를 실패로 노출한다.
- `MemoryManager.getMemoryForPrompt()`는 compatibility 용도로 남지만 `null`을 반환한다.
- normal execution hot path에서 memoryBlock 주입은 제거됐다.

Persistent mounts:

```text
/mnt/storage/agent-hub-core/providers/codex  → /root/.codex
/mnt/storage/agent-hub-core/providers/gemini → /root/.gemini
```

따라서 native session/auth/rules는 container redeploy 후에도 유지된다.

---

## 8. Failure Semantics

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

Memory sync도 silent partial success를 허용하지 않는다.

---

## 9. Observability

예:

```text
[Sessions] logical switch: user=<id> session=<logical-id> active_provider=codex mappings=codex:READY:<short>,antigravity:READY:<short>

[NativeSession] handoff logical=<logical-id> codex(READY:<short>) -> antigravity(READY:<short>) messages=N

[MemorySync] provider rules 동기화 완료: codex=<path>, antigravity=<path>
```

native ref는 전체를 노출하지 않고 short ref만 사용한다.

---

## 10. Implementation / PR Record

### Original native bridge

```text
PR #7  bridge: migrate V1 conversations to provider-native sessions
```

- Provider lifecycle schema/repository
- Codex JSONL native create/resume
- Antigravity native create/resume
- same-provider native continuation
- cross-provider delta handoff
- lazy binding

Regression: SUCCESS.

### Native callback routing hotfix

```text
PR #8  fix: route native session callbacks
```

Regression: SUCCESS.

### Logical Session-first correction

```text
PR #9  fix: make /sessions logical-session first
Main SHA: f66003370257b12cc02c83bdcf25ccf368c31893
```

Regression: SUCCESS.

### Provider-native Rules Memory

```text
PR #10 feat: mirror /memory into provider native rules
Main SHA: 4ab3e4d0c11e8d67459fc01691b509bdd2547a55
```

최종 CI:

```text
Phase 11 Regression run #141
status = completed
conclusion = success
```

---

## 11. Final Live Validation

최종 검증은 Agent Hub SQLite와 Codex/Antigravity native conversation stores를 모두 초기화한 **clean-state environment**에서 다시 시작했다.

### Lazy binding

`/new` 직후:

```text
CODEX: UNBOUND
```

첫 Codex message 실행 후:

```text
CODEX: READY · <thread-id>
```

PASS.

### Bridge validation

사용자가 최종 1~19 validation checklist로 재검증했다.

최종 release 판정:

```text
1~18 = PASS
19 = post-release soak / real development workflow observation
```

검증된 범위에는 다음이 포함된다.

- Codex same-provider native continuity
- independent Logical Session A/B isolation
- `/sessions` Logical Session switch 후 올바른 native ref 복귀
- Codex → Antigravity first handoff
- one Logical Session 안의 Codex/Antigravity independent native mappings
- Antigravity same-provider continuation
- Antigravity → Codex delta handoff
- Provider 왕복 후 native identity 유지
- restart/redeploy 후 Logical Session persistence
- restart/redeploy 후 Codex native continuity
- restart/redeploy 후 Antigravity native continuity

### Test 19 disposition

실제 5~10 turn 개발 작업 soak test는 특정 시점의 one-shot release gate보다 **지속적인 운영 관찰 항목**으로 분류했다.

사용자는 1~18의 clean-state validation 결과와 현재 실사용 동작을 근거로 V2 승격을 승인했다. 이후 장기 workflow에서 발견되는 문제는 V2 regression bug로 추적한다.

### Provider Rules Memory validation

실환경에서 `/memory` 변경 후:

```text
/data/memory/MEMORY.md
/root/.codex/AGENTS.md
/root/.gemini/GEMINI.md
```

에 동일 canonical memory가 반영되고, Codex와 Antigravity가 별도 per-turn memory prompt 주입 없이 해당 규칙을 읽는 것을 확인했다.

PASS / DONE.

---

## 12. Definition of DONE — Final

- [x] Codex same-provider normal turns use the same native thread.
- [x] Antigravity same-provider normal turns use the same native conversation.
- [x] same-provider normal turns do not reconstruct summary + recent transcript.
- [x] `/new` creates a Logical Session and lazily binds Provider native identity.
- [x] `/sessions` always selects Agent Hub Logical Sessions.
- [x] one Logical Session can hold independent Codex and Antigravity native mappings.
- [x] `/model` switches Provider inside the same Logical Session.
- [x] cross-provider return uses delta handoff.
- [x] restart/redeploy preserves Logical Session → Provider native mapping continuity.
- [x] missing native sessions do not silently become blank new sessions.
- [x] `/memory` canonical content mirrors into Codex/Antigravity native Rules.
- [x] Global Memory is not injected per turn.
- [x] full regression CI succeeds.
- [x] clean-state mandatory live Bridge scenarios 1~18 succeed.
- [x] Provider Rules Memory live validation succeeds.
- [x] architecture record is finalized.
- [x] Status = `DONE`.

---

## 13. V2 Promotion

V2 promotion is now authorized.

Release target:

```text
Agent Hub Core V2
version = 2.0.0
```

Promotion scope:

- legacy runtime/UI `V1` branding → `V2`
- startup banner → `Agent Hub Core V2 · 2.0.0`
- Telegram help branding → `Agent Hub Core V2 · 2.0.0`
- package version → `2.0.0`
- README rewritten around final V2 architecture
- this Bridge/Memory record closed as DONE

Historical filenames such as `v1-lifecycle.test.js` or this migration document's `V1 → V2` title may remain because they describe historical test/migration scope rather than current product branding.

---

## 14. Final Decision Summary

### Session authority

```text
User-facing identity
= Agent Hub Logical Session

AI conversational continuity
= Provider Native Session
```

### Memory authority

```text
Canonical long-term rules
= Agent Hub /data/memory/MEMORY.md

Execution rules
= Codex AGENTS.md + Antigravity GEMINI.md mirrors
```

### Prompt authority

```text
same-provider normal turn
= current request → existing native session

provider return
= missed cross-provider delta + current request → existing native session
```

V2의 최종 구조는 Agent Hub가 Provider 기능을 재구현하는 것이 아니라, **Logical Session, native conversation, native Rules의 책임을 분리하고 안정적으로 연결하는 orchestration layer**가 되는 것이다.

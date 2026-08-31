# Phase 16: Feature Stabilization & Optimization

## Status

`PLANNED`

Phase 16은 신규 대형 기능을 추가하는 단계가 아니라, V1 이후 실제 사용에서 드러난 미완성 기능과 조작 불가능한 Provider 옵션을 정리하는 안정화·최적화 단계다.

확정 범위는 Canonical Context Compact, Model Reasoning/Thinking Level, Provider Usage/Quota Visibility다. Backend API Preview와 MCP/Skills는 각각 Phase 17과 Phase 18로 분리한다.

---

## 1. Agent Hub Canonical Context Compact

### 1.1 현재 문제

- Telegram `/compact` 명령과 `auto_compact_threshold` 설정은 존재한다.
- 현재 `Compactor`는 Provider adapter의 native `compact()`만 호출한다.
- Codex와 Antigravity 모두 비대화형 실행에서 호출 가능한 native compact가 없어 항상 `UNSUPPORTED`로 끝난다.
- `sessions.rolling_summary`와 Canonical message 구조는 있지만 실제 압축 pipeline과 자동 발동 로직이 없다.
- 결과적으로 `/compact`와 Auto Compact UI가 동작하는 기능처럼 보이지만 실질적으로는 dead feature다.

### 1.2 결정

Provider native compact를 억지로 호출하지 않고 **Agent Hub 자체 Canonical Context Compact**를 구현한다.

- Agent Hub 세션 ID, Telegram 세션, 작업 디렉터리, Git 상태는 그대로 유지한다.
- `/new`를 실행하거나 사용자에게 새 세션을 만들지 않는다.
- SQLite의 원본 `messages`는 삭제·수정하지 않고 계속 canonical history로 보존한다.
- 오래된 메시지만 요약해 `rolling_summary`를 갱신한다.
- 이후 Provider 요청에는 `rolling_summary + 압축 기준점 이후 최근 원문 + 새 사용자 메시지`를 전달한다.
- Codex와 Antigravity에 동일한 Agent Hub 동작 의미를 제공한다.

```text
동일 Agent Hub 세션
├─ 오래된 Canonical messages ──> rolling_summary
├─ 압축 기준점 이후 messages ──> 원문 유지
└─ 새 사용자 메시지
                         ↓
              Provider 실행 컨텍스트
```

### 1.3 압축 상태와 데이터 경계

`rolling_summary`만 저장해서는 어떤 메시지까지 요약했는지 판별할 수 없으므로 명시적인 압축 cursor가 필요하다.

최소 상태:

- `rolling_summary`
- 마지막으로 요약에 포함된 Canonical message ID 또는 안정적인 SQLite cursor
- 마지막 압축 시각
- 가능하면 압축 전/후 추정 token 또는 character count

규칙:

- cursor 이전 메시지를 다음 Provider prompt에 다시 중복 첨부하지 않는다.
- 최근 대화 tail은 원문으로 남겨 지시사항과 현재 작업 흐름을 보존한다.
- 기존 summary가 있으면 `기존 summary + 새로 압축할 구간`을 다시 요약해 rolling update한다.
- 압축용 Provider 응답은 사용자/assistant Canonical 대화 메시지로 저장하지 않는다.
- 압축 실패 시 기존 summary와 cursor를 그대로 유지한다.
- summary와 cursor 갱신은 하나의 DB transaction으로 처리한다.
- 실행 중인 사용자 Job과 수동/자동 compact의 동시성 충돌을 막는다.
- 압축할 분량이 부족하면 성공을 가장하지 않고 `변경 없음`으로 알린다.

### 1.4 `/compact` 수동 실행

- 활성 Agent Hub 세션만 압축한다.
- 실행 전에 대상 범위와 최근 원문 보존 범위를 계산한다.
- 완료 결과에 압축된 메시지 수, 남긴 최근 메시지 수, 압축 전/후 크기를 표시한다.
- token 수치를 Provider에서 얻을 수 없으면 추정치임을 명시하고 가짜 정밀 수치를 만들지 않는다.
- Canonical 원문이 보존된다는 점을 UI에 표시한다.
- 빈 세션, 짧은 세션, 압축 진행 중, 실패 상태를 구분한다.

### 1.5 Auto Compact

`/settings`의 `auto_compact_threshold`를 실제 실행 경로에 연결한다.

- 임계치 판단은 Provider 호출 직전의 실제 조립 컨텍스트를 기준으로 한다.
- Provider/model별 context window를 신뢰성 있게 알 수 있을 때는 token 사용 비율을 사용한다.
- context window를 알 수 없으면 임의 비율을 꾸며내지 않고 보수적인 fallback 기준을 별도로 정의하거나 Auto Compact를 `UNKNOWN/UNAVAILABLE`로 표시한다.
- 자동 압축 후 같은 사용자 요청을 새 컨텍스트로 정상 실행한다.
- 한 요청에서 compact/retry loop가 반복되지 않게 최대 1회로 제한한다.
- 자동 압축 실패가 원래 사용자 요청을 무조건 유실시키지 않도록 실패 정책을 명시한다.
- 수동 `/compact`와 자동 압축은 같은 service와 transaction 경계를 사용한다.

### 1.6 Summary 품질

요약에는 최소 다음 정보를 보존한다.

- 사용자의 목표와 확정된 결정
- 현재 작업 위치와 진행 상태
- 변경한 파일 및 중요한 구현 내용
- 검증 결과와 남은 문제
- 환경/권한/배포 제약
- 사용자가 명시한 선호와 금지사항
- 정확히 유지해야 하는 식별자, 경로, 명령, 오류 핵심

비밀값, token, credential은 summary에 넣지 않는다. summary prompt와 결과에도 기존 secret-redaction 규칙을 적용한다.

---

## 2. Model Reasoning / Thinking Level

### 2.1 현재 문제

- `/model`은 Provider와 Model만 선택할 수 있다.
- 세션에 reasoning/thinking level을 저장하는 필드가 없다.
- Job Runtime에서 adapter로 사고 레벨을 전달하지 않는다.
- Codex adapter는 reasoning level을 CLI에 전달하지 않는다.
- Antigravity adapter는 기본 모델 실행 시 `--effort medium`을 내부에서 고정해 사용자가 바꿀 수 없다.

### 2.2 목표

`/model`에서 현재 세션의 Model과 사고 레벨을 함께 설정할 수 있게 한다.

사용자 UI 명칭은 `Thinking` 또는 `사고 레벨`로 통일하고, 내부 canonical 명칭은 `reasoning_effort`를 사용한다.

기본 UX:

```text
/model
  -> Provider 선택
  -> Model 선택
  -> 해당 Provider/Model이 지원하는 사고 레벨 선택
  -> Provider / Model / Thinking 최종 적용
```

현재 선택값은 `/model`, `/status`, 세션 상세 및 Job status에서 확인할 수 있어야 한다.

### 2.3 저장 범위와 기본값

- 사고 레벨은 **세션 단위**로 저장한다.
- 최소 후보는 `default`, `low`, `medium`, `high`다.
- 실제 허용값은 Provider와 설치된 CLI 버전의 capability를 기준으로 결정한다.
- Provider가 `minimal`, `xhigh` 등 추가 값을 공식 지원하면 capability 결과에 따라 노출할 수 있다.
- 모든 Provider가 같은 enum을 지원한다고 가정하지 않는다.
- `default`는 Agent Hub가 임의 값을 강제하지 않고 해당 Provider/Model의 CLI 기본값을 사용한다는 뜻이다.
- 신규 세션은 설정된 기본 사고 레벨이 있으면 승계하고, 없으면 `default`를 사용한다.
- 기존 세션 migration은 `default`로 안전하게 처리한다.

### 2.4 Provider Adapter Contract

공통 실행 옵션에 `reasoningEffort`를 추가한다.

```text
executePrompt({
  prompt,
  model,
  reasoningEffort,
  profile,
  cwd,
  signal
})
```

각 adapter는 canonical 값을 현재 pinned CLI가 요구하는 인자/설정으로 변환한다.

- Codex: pinned version에서 검증한 reasoning effort 설정 문법으로 전달
- Antigravity: 검증된 `--effort <level>`로 전달
- restricted helper와 `FULL_ACCESS` 직접 실행 경로가 동일한 값을 사용
- Scheduler, title generation, compact 같은 내부 작업은 각각 명시한 정책을 사용하고 활성 세션 값을 무조건 오염시키지 않는다.
- 지원하지 않는 level은 조용히 `medium` 등으로 치환하지 않고 실행 전에 거부한다.
- CLI가 option을 거부하면 사용자에게 Provider/Model/level과 실제 오류를 명확히 보여준다.

### 2.5 Capability Discovery

모델 목록과 마찬가지로 reasoning level도 capability-driven으로 관리한다.

- Provider capability에 reasoning effort 지원 상태와 허용 level 목록을 추가한다.
- pinned CLI 업그레이드 시 help/schema/runtime probe로 다시 검증한다.
- 모델별 지원 범위가 다르면 모델 metadata에 귀속한다.
- 동적 조회가 불가능한 경우 capability baseline에 검증된 값만 기록한다.
- 조회 실패 시 지원하지 않는 값을 임의로 UI에 노출하지 않는다.
- `CAPABILITIES_CODEX.md`, `CAPABILITIES_ANTIGRAVITY.md`와 regression을 함께 갱신한다.

### 2.6 `/model` UI 동작

- 현재 Provider, Model, Thinking을 첫 화면에 함께 표시한다.
- 모델 선택 후 사고 레벨을 고르게 하되, `default` 포함 지원값만 버튼으로 표시한다.
- 기존 Provider/model handoff와 사고 레벨 변경의 책임을 분리한다.
- 같은 Provider에서 level만 바꾸는 경우 불필요한 Provider handoff를 만들지 않는다.
- Provider/model 전환 실패 시 기존 Provider/model/level을 모두 유지한다.
- 적용 완료 화면에서 세 값을 한 번에 확인할 수 있게 한다.
- NORMAL/STEALTH UI 모두 의미가 유지되어야 한다.

---

## 3. Provider Usage / Quota Visibility

### 3.1 현재 문제

- Agent Hub `/usage`는 자체 Job 실행 횟수와 실행 시간만 집계한다.
- Provider quota 영역은 Codex와 Antigravity 모두 항상 `표시하지 않음`으로 고정돼 있다.
- `/status`도 Provider health/auth만 보여주며 실제 계정의 남은 사용 한도는 보여주지 않는다.
- 반면 각 Provider의 대화형 CLI status 화면에서는 계정에 적용된 단기/장기 사용량 window를 확인할 수 있다.
- 따라서 사용자는 Telegram에서 작업을 시작하기 전에 한도 소진 여부를 판단할 수 없다.

### 3.2 목표와 명령 역할

Codex와 Antigravity가 실제로 노출하는 계정 사용량 및 한도를 Agent Hub에서 조회해 표시한다.

- `/usage`: Provider별 상세 사용량 화면의 canonical 진입점으로 사용한다.
- `/status`: 전체 Health 화면을 과도하게 키우지 않고 Provider별 남은 한도 요약과 조회 시각만 표시한다.
- `/status`의 상세 버튼 또는 안내를 통해 `/usage`로 이동할 수 있게 한다.
- Agent Hub 자체 Job 통계와 Provider 계정 quota를 명확히 분리한다.
- Provider가 제공하지 않은 수치, reset 시각 또는 token 값을 추정하지 않는다.

표시 예시의 의미는 다음과 같다. 실제 label과 window는 Provider 응답을 따른다.

```text
Provider Usage

Codex
- 5시간 한도: 42% 사용 / 58% 남음 / reset 2시간 14분 후
- 주간 한도: 67% 사용 / 33% 남음 / reset 3일 8시간 후
- 조회: 2026-08-31 14:20 KST

Antigravity
- 단기 window: Provider가 반환한 label/value/reset
- 장기 window: Provider가 반환한 label/value/reset
```

### 3.3 Provider Adapter Contract

공통 adapter에 read-only usage 조회 contract를 추가한다.

```text
getUsageQuota({ forceRefresh })
  -> provider
  -> accountLabel?       // 노출이 안전한 경우만
  -> windows[] {
       id,
       label,
       usedPercent?,
       remainingPercent?,
       resetsAt?,
       resetAfterSeconds?
     }
  -> fetchedAt
  -> source
  -> status: AVAILABLE | PARTIAL | UNAVAILABLE | ERROR
```

규칙:

- Codex는 5시간/주간 window처럼 CLI가 실제 반환한 항목을 파싱한다.
- Antigravity도 해당 계정과 CLI가 실제 반환한 window만 파싱한다.
- machine-readable API/출력을 우선 사용한다.
- 대화형 status 화면만 제공되는 경우 pinned CLI 버전에서 검증된 PTY 조회와 parser를 별도 격리해 사용할 수 있다.
- TUI 문구 변경이나 일부 field 누락은 전체 `/usage` 실패가 아니라 해당 Provider의 `PARTIAL` 또는 `UNAVAILABLE`로 처리한다.
- percentage가 used인지 remaining인지 명확하지 않으면 임의 변환하지 않는다.
- reset timestamp와 상대 시간이 함께 있으면 서버 timezone과 무관한 원본 timestamp를 canonical 값으로 저장하고 Telegram에는 KST 및 상대 시간을 함께 표현한다.
- 인증 token, credential, raw account identifier, raw status dump는 Telegram과 일반 log에 노출하지 않는다.
- usage 조회는 quota를 소비하는 일반 Prompt Job으로 기록하지 않는다.

### 3.4 조회·캐시·장애 정책

- `/usage` 호출마다 무조건 Provider 프로세스를 중복 실행하지 않도록 짧은 TTL cache를 둔다.
- 사용자가 명시적으로 새로고침할 수 있는 inline action을 제공하되 debounce/rate limit을 적용한다.
- Provider별 조회는 독립적으로 수행해 Codex 실패가 Antigravity 결과를 가리지 않게 한다.
- timeout을 짧게 제한하고 마지막 성공 cache가 있으면 `stale`과 마지막 조회 시각을 명시해 표시한다.
- cache도 없고 조회도 실패하면 `조회 실패`와 짧은 원인만 표시한다.
- 동일 Provider에 대한 동시 `/status`, `/usage` 요청은 single-flight로 합친다.
- Core 시작과 매 Job 실행 시마다 quota 조회를 강제하지 않는다.
- CLI 업그레이드 시 fixture/parser regression과 실제 계정 smoke test로 다시 검증한다.

### 3.5 UI 세부 기준

- 사용률과 잔여율 중 Provider가 제공한 기준을 명확히 표기한다.
- progress bar를 사용하더라도 원본 percentage와 의미를 텍스트로 함께 표시한다.
- reset 정보가 없으면 `미제공`으로 표시한다.
- 한도 window 이름을 Codex 기준으로 하드코딩해 Antigravity에 재사용하지 않는다.
- NORMAL/STEALTH UI에서 정보량과 의미가 같아야 한다.
- 향후 경고 기능을 붙일 수 있도록 Provider/window별 threshold 구조는 열어두되, Phase 16에서 자동 경고를 구현할지는 범위 수집 종료 후 결정한다.

---

## 4. 예상 변경 범위

- sessions schema migration: compact cursor/metadata, `reasoning_effort`
- ContextManager context assembly 및 Compactor 재구현
- Auto Compact threshold evaluator와 Job Runtime 연결
- ProviderAdapter execution/capability contract 확장
- Codex/Antigravity adapter argument mapping
- ProviderAdapter usage/quota contract, Provider별 status probe/parser 및 TTL cache
- `/compact`, `/model`, `/settings`, `/status`, `/usage`, session/job renderer 갱신
- Capability baseline 문서와 regression 갱신

파일명과 migration version은 Phase 16 착수 시 현재 repository 상태를 기준으로 확정한다.

---

## 5. Acceptance / E2E

### Compact

- [ ] `/compact` 후 Agent Hub 세션 ID와 활성 세션이 바뀌지 않는다.
- [ ] Canonical 원본 messages가 삭제되거나 수정되지 않는다.
- [ ] 오래된 메시지는 summary에 반영되고 최근 tail은 원문으로 유지된다.
- [ ] compact cursor 이전 원문이 다음 Provider prompt에 중복 포함되지 않는다.
- [ ] 두 번 이상 압축해도 기존 summary와 신규 구간이 연속성을 유지한다.
- [ ] 압축 실패 시 기존 summary/cursor가 손상되지 않는다.
- [ ] `auto_compact_threshold` 도달 시 자동 압축 후 원래 요청이 정상 실행된다.
- [ ] context window를 모르는 경우 가짜 사용률을 표시하거나 임의 압축하지 않는다.
- [ ] Codex와 Antigravity 전환 후에도 동일한 Canonical summary를 사용할 수 있다.
- [ ] Core 재배포 후 summary와 cursor가 유지된다.

### Reasoning / Thinking

- [ ] `/model`에서 현재 Provider/Model/Thinking을 확인할 수 있다.
- [ ] Provider/Model별 지원 level만 선택할 수 있다.
- [ ] 선택한 level이 세션에 저장되고 재배포 후에도 유지된다.
- [ ] Codex의 restricted/FULL_ACCESS 실행 모두 선택값을 실제 CLI에 전달한다.
- [ ] Antigravity가 고정 `medium` 대신 세션 선택값을 실제 CLI에 전달한다.
- [ ] 같은 Provider에서 level만 변경할 때 불필요한 handoff가 발생하지 않는다.
- [ ] Provider 전환 실패 시 기존 Provider/Model/level이 원자적으로 유지된다.
- [ ] 지원하지 않는 level을 silent fallback하지 않는다.
- [ ] 신규 세션과 기존 세션 migration의 기본값이 명확히 동작한다.

### Provider Usage / Quota

- [ ] `/usage`에서 Agent Hub Job 통계와 Provider 계정 quota가 분리돼 표시된다.
- [ ] Codex가 실제 노출하는 5시간/주간 사용량과 reset 정보를 확인할 수 있다.
- [ ] Antigravity가 실제 노출하는 quota window와 reset 정보를 확인할 수 있다.
- [ ] `/status`에서 Provider별 남은 한도 요약과 조회 시각을 확인할 수 있다.
- [ ] Provider가 제공하지 않은 수치나 reset 시각을 추정하지 않는다.
- [ ] 한 Provider 조회 실패가 다른 Provider와 Agent Hub 통계 표시를 막지 않는다.
- [ ] cache hit, 강제 새로고침, stale fallback, timeout, parser 실패가 구분된다.
- [ ] 동시 `/status`와 `/usage` 조회가 Provider probe를 중복 실행하지 않는다.
- [ ] credential과 민감한 account identifier가 UI/log에 노출되지 않는다.
- [ ] pinned Codex/Antigravity CLI fixture와 실제 계정 smoke test가 통과한다.

---

## 6. 완료 조건

구현 시 Compact → Reasoning/Thinking → Usage/Quota 순서를 기본으로 하되, 착수 시 repository 상태에 따라 세부 작업 단위를 조정한다.

구현 완료 후 자동 테스트와 실제 Telegram E2E에서 다음 흐름을 모두 통과해야 `DONE` 처리한다.

```text
동일 세션 장기 대화
-> 수동/자동 compact
-> Core 재배포
-> Provider 전환
-> Model 및 Thinking 변경
-> /usage에서 Codex/Antigravity 단기·장기 한도 확인
-> /status에서 Provider quota 요약 확인
-> 기존 작업 문맥을 유지한 후속 요청 성공
```

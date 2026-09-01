# Codex CLI Capability Baseline

> **Pinned Version:** `@openai/codex@0.149.1`\
> **Audit Date:** 2026-09-01\
> **Audit Environment:** Node.js v20+, npm CLI

---

## 1. Capability Summary Table

| Capability Area | Status | Verification & Syntax Details |
|---|---|---|
| **Auth Persistence** | `SUPPORTED` | `~/.codex` 또는 `$CODEX_HOME` 디렉토리 (`config.toml`, auth tokens). Docker 볼륨 마운트(`/data/providers/codex` -> `$CODEX_HOME`)로 영속화 가능. |
| **Non-Interactive Execution** | `SUPPORTED` | `codex exec [PROMPT]` 또는 `codex exec - < stdin`. `--dangerously-bypass-approvals-and-sandbox` 및 `--skip-git-repo-check` 플래그로 자동화 환경 구동 가능. |
| **JSON / Machine-Readable Output** | `SUPPORTED` | `codex exec --json` 플래그로 stdout에 JSONL 이벤트 스트림 출력. `-o, --output-last-message <FILE>`로 최종 에이전트 답변 파일 추출 가능. |
| **Native Session Creation & Resume** | `SUPPORTED` | `codex exec resume <SESSION_ID> [PROMPT]` 지원. `--last`로 가장 최근 세션 재개 가능. 세션 ID는 UUID 지원. |
| **Model Specification / Switching** | `SUPPORTED` | `-m, --model <MODEL>` 옵션으로 세션/단일 실행 시 모델 지정 가능. |
| **Dynamic Model Discovery** | `SUPPORTED` | app-server JSON-RPC `model/list`가 model ID, 기본 모델, `supportedReasoningEfforts`, `defaultReasoningEffort`를 machine-readable 응답으로 제공한다. |
| **Reasoning Effort** | `SUPPORTED` | 모델별 허용값은 `model/list` metadata를 사용하고 실행에는 config key `model_reasoning_effort`를 전달한다. 모델별 enum을 하드코딩하지 않는다. |
| **Health / Auth Diagnosis** | `SUPPORTED` | `codex doctor --json` 실행 시 머신 리더블 형태로 진단 결과 및 설정 상태 반환. |
| **Sandbox & Approval Control** | `SUPPORTED` | `-s, --sandbox <read-only \| workspace-write \| danger-full-access>` 및 `-a, --ask-for-approval <on-request \| never>`. |
| **Image & Multi-Attachment** | `SUPPORTED` | `-i, --image <FILE>...` 옵션으로 여러 이미지 파일 경로 전달 지원. |
| **Generic File Handling** | `PARTIAL` | 파일 자체를 CLI 옵션으로 직접 전달하기보다는 persistent development root(`/home/dev`) 또는 `/data/uploads/`의 경로를 프롬프트에 참조시켜 처리. |
| **Usage / Token Quota** | `SUPPORTED` | app-server JSON-RPC `account/rateLimits/read`가 primary/secondary window의 used percent, duration, reset timestamp를 제공한다. 독립 CLI subcommand가 아닌 app-server protocol을 사용한다. |
| **Native Compact** | `UNSUPPORTED` | CLI 독립 `compact` 서브커맨드는 없다. `/compact`는 Provider native 기능이 아니라 Agent Hub Canonical rolling summary로 구현한다. |
| **Cancellation & Process Control** | `SUPPORTED` | `SIGINT`/`SIGKILL` 시그널 전달로 자식 프로세스 즉시 중단 가능. |

---

## 2. Recommended CLI Execution Templates

### 1) 신규 프롬프트 비대화형 실행 (JSONL 스트림)
```bash
codex exec \
  --json \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  -C /home/dev \
  -m "gpt-4o" \
  "사용자 프롬프트 내용"
```

### 2) 기존 네이티브 세션 재개 (Resume)
```bash
codex exec resume <SESSION_UUID> \
  --json \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  "이어지는 사용자 프롬프트"
```

### 3) 헬스 및 인증 진단
```bash
codex doctor --json
```

---

## 3. Provider Rules for Codex Adapter

1. 모델 리스트를 코드에 절대 하드코딩하지 않는다.
2. Usage/Quota는 app-server `account/rateLimits/read`가 반환한 필드만 표시하며 누락값을 추정하지 않는다.
3. 네이티브 Compact는 사용하지 않는다. `/compact`는 Canonical 원문을 보존한 채 Agent Hub rolling summary와 message UUID cursor를 갱신한다.
4. `model/list`의 reasoning metadata를 모델 캐시에 보존하고, `default`는 config를 생략한다. 명시 level은 restricted/FULL_ACCESS 모두 `-c model_reasoning_effort="<level>"`로 전달한다.

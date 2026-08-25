# Codex CLI Capability Baseline

> **Pinned Version:** `@openai/codex@0.149.1`\
> **Audit Date:** 2026-08-25\
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
| **Dynamic Model Discovery** | `PARTIAL` | `codex doctor --json` 또는 help/config 인터페이스 제공. 공식 전용 `codex models list` 명령은 부재하므로, `doctor` 진단 및 provider config 파싱 활용. (하드코딩 금지, 불확실 시 `UNSUPPORTED` fallback). |
| **Health / Auth Diagnosis** | `SUPPORTED` | `codex doctor --json` 실행 시 머신 리더블 형태로 진단 결과 및 설정 상태 반환. |
| **Sandbox & Approval Control** | `SUPPORTED` | `-s, --sandbox <read-only \| workspace-write \| danger-full-access>` 및 `-a, --ask-for-approval <on-request \| never>`. |
| **Image & Multi-Attachment** | `SUPPORTED` | `-i, --image <FILE>...` 옵션으로 여러 이미지 파일 경로 전달 지원. |
| **Generic File Handling** | `PARTIAL` | 파일 자체를 CLI 옵션으로 직접 전달하기보다는 워크스페이스 디렉토리 경로(`./workspace/` 또는 `/data/uploads/`)를 프롬프트에 참조시켜 처리. |
| **Usage / Token Quota** | `PARTIAL` | `--json` 출력 스트림의 이벤트에서 일부 토큰 사용량 정보 수신 가능. CLI 단독 `usage` 쿼터 조회 명령은 미제공. |
| **Native Compact** | `UNSUPPORTED` | CLI 명령으로 직접 호출 가능한 독립 `compact` 서브커맨드 부재. 세션 롤링 및 압축은 내부 엔진 자동 또는 Agent Hub Summary로 보조 처리. |
| **Cancellation & Process Control** | `SUPPORTED` | `SIGINT`/`SIGKILL` 시그널 전달로 자식 프로세스 즉시 중단 가능. |

---

## 2. Recommended CLI Execution Templates

### 1) 신규 프롬프트 비대화형 실행 (JSONL 스트림)
```bash
codex exec \
  --json \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  -C /workspace \
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
2. CLI에서 제공하지 않는 사용량/쿼터 수치를 임의로 지어내지 않는다 (`UNKNOWN` 유지).
3. 네이티브 Compact가 지원되지 않으므로 `/compact` 시 억지 fallback을 하지 않고 명확히 보고한다.

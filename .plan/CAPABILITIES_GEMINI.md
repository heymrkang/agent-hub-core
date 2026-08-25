# Gemini CLI Capability Baseline

> **Pinned Version:** `@google/gemini-cli@0.56.0`\
> **Audit Date:** 2026-08-25\
> **Audit Environment:** Node.js v20+, npm CLI

---

## 1. Capability Summary Table

| Capability Area | Status | Verification & Syntax Details |
|---|---|---|
| **Auth Persistence** | `SUPPORTED` | `GEMINI_API_KEY` 환경변수 또는 `~/.gemini` 설정 디렉토리. Docker 볼륨 마운트(`/data/providers/gemini` -> `~/.gemini`)로 영속화 지원. |
| **Non-Interactive Execution** | `SUPPORTED` | `gemini -p "<prompt>" --approval-mode yolo --skip-trust` 로 완전 비대화형 headless 실행 가능. |
| **JSON / Machine-Readable Output** | `SUPPORTED` | `-o, --output-format json` 또는 `stream-json` 옵션 지원. |
| **Native Session Creation & Resume** | `SUPPORTED` | `--session-id <UUID>`로 명시적 세션 ID 생성 지원. `-r, --resume latest` 또는 `--resume <index>`로 세션 재개 지원. `--list-sessions` 지원. |
| **Model Specification / Switching** | `SUPPORTED` | `-m, --model <MODEL>` 옵션 지원 (예: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-1.5-pro`). |
| **Dynamic Model Discovery** | `PARTIAL` | CLI 자체 전용 모델 리스트 명령 부재 시, 기본 추천 모델 풀(Gemini 2.5 Pro, Gemini 2.5 Flash 등) 및 config 연동. |
| **Health / Auth Diagnosis** | `SUPPORTED` | `gemini -v` (버전 확인) 및 `gemini -p "ping" --approval-mode yolo`를 통한 헬스/인증 실시간 체크 지원. |
| **Sandbox & Approval Control** | `SUPPORTED` | `--approval-mode <default \| auto_edit \| yolo \| plan>` 및 `-s, --sandbox` 지원. |
| **Image & Multi-Attachment** | `SUPPORTED` | 워크스페이스 디렉토리 경로 전달 및 Gemini 멀티모달 프롬프트 인식 지원. |
| **Usage / Token Quota** | `PARTIAL` | JSON 출력 스트림에서 토큰 메타데이터 확인 가능. 독립 쿼터 조회 명령은 미제공. |
| **Native Compact** | `UNSUPPORTED` | 독립 `compact` 서브커맨드 부재. Agent Hub Canonical Context 및 Summary로 관리. |
| **Cancellation & Process Control** | `SUPPORTED` | `SIGINT`/`SIGKILL` 시그널 전달로 자식 프로세스 즉시 중단 가능. |

---

## 2. Recommended CLI Execution Templates

### 1) 신규 프롬프트 비대화형 실행
```bash
gemini \
  -p "사용자 프롬프트 내용" \
  -m "gemini-2.5-flash" \
  --approval-mode yolo \
  --skip-trust \
  -o text
```

### 2) 기존 네이티브 세션 재개 (Resume)
```bash
gemini \
  -r latest \
  -p "이어지는 사용자 프롬프트" \
  --approval-mode yolo \
  --skip-trust \
  -o text
```

---

## 3. Provider Rules for Gemini Adapter

1. 모델 리스트를 코드에 임의로 꾸며내지 않고 공식 권장 모델 ID를 명확히 매핑한다.
2. CLI에서 제공하지 않는 사용량/쿼터 수치를 임의로 추정하지 않는다 (`UNKNOWN` 유지).
3. 네이티브 Compact가 미지원되므로 `/compact` 호출 시 명확히 `UNSUPPORTED`로 보고한다.

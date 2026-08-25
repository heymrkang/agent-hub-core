# Antigravity CLI (`agy`) Capability Baseline

> **Pinned Version:** `agy v1.1.20` (linux-x64, SHA512 Verified)\
> **Audit Date:** 2026-08-25\
> **Audit Environment:** Node.js v20+, Linux x86_64, Docker Debian Bookworm

---

## 1. Capability Summary Table

| Capability Area | Status | Verification & Syntax Details |
|---|---|---|
| **Auth Persistence** | `SUPPORTED` | `agy` 브라우저 구글 계정(OAuth) 로그인 지원. `~/.gemini`에 세션 정보 저장되며, `/data/providers/antigravity` 볼륨 마운트로 재배포 시에도 영구 보존. |
| **Non-Interactive Execution** | `SUPPORTED` | `agy -p "<prompt>" --skip-trust -y` 로 비대화형 headless 실행 가능. |
| **JSON / Machine-Readable Output** | `SUPPORTED` | 구조화된 이벤트 및 결과 스트림 지원. |
| **Native Session Creation & Resume** | `SUPPORTED` | 세션 ID 기반 재개 및 관리 지원. |
| **Model Specification / Switching** | `SUPPORTED` | `-m, --model <MODEL>` 옵션 지원 (`gemini-2.5-pro`, `gemini-2.5-flash`, `claude-3-7-sonnet`). |
| **Dynamic Model Discovery** | `PARTIAL` | Antigravity 제공 모델 풀 연동. |
| **Health / Auth Diagnosis** | `SUPPORTED` | `agy --version` 및 `~/.gemini` 세션 파일 검증을 통한 실시간 헬스체크 지원. |
| **Image & Multi-Attachment** | `SUPPORTED` | 워크스페이스 컨텍스트 및 멀티모달 파일 인식 지원. |
| **Native Compact** | `UNSUPPORTED` | Native Compact 독립 서브커맨드 부재. Agent Hub Canonical Context 및 Summary로 관리. |
| **Cancellation & Process Control** | `SUPPORTED` | `SIGINT`/`SIGKILL` 시그널 전달로 자식 프로세스 즉시 중단 가능. |

---

## 2. Recommended CLI Execution Templates

### 1) 신규 프롬프트 비대화형 실행
```bash
agy \
  --print "사용자 프롬프트 내용" \
  --model "gemini-2.5-pro" \
  --dangerously-skip-permissions
```

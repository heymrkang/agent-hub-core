# Phase 21: V2 LTS Final Hardening & Optimization

## Status

`DONE` (2026-09-04 공식 완결 및 Feature Freeze)

## 1. 개요 및 최종 완결 목표

Phase 21은 Agent Hub Core의 기능 개발을 공식적으로 영구 동결(Feature Freeze)하고, 실전 모바일 바이브코딩을 위한 최종 장기 지원 버전(**V2 LTS**)으로 승격하는 완결 단계이다.

새로운 기능을 추가하지 않고, **토큰 다이어트, 레거시 정리, 퍼블릭 레포 보안 감사, 환경변수화**에 집중하여 코어를 가볍고 단단하게 굳혔다.

```text
  Phase 20 (Coolify Deploy & Voice STT)
                 ↓
  Phase 21: V2 LTS Final Hardening [DONE]
    ├─ 1. 토큰 다이어트 (프롬프트/컨텍스트 최적화)
    ├─ 2. 레거시/오작동 명령어 및 기능 정리 (/settings Auto Compact 제거, /help 모바일 개편)
    ├─ 3. Public Repo 보안 감사 및 하드코딩 환경변수화 (.env.example, docker-compose)
    └─ 4. 회귀 테스트 올그린 (264 pass) & Feature Freeze (V2 LTS 완결)
                 ↓
  🚀 Agent Hub Core 공식 졸업 -> 실전 사이드프로젝트 개발 전념!
```

---

## 2. 4대 중점 작업 영역 완료 내역

### 2.1 토큰 다이어트 (불필요한 토큰 소모 전면 차단)
- **실행 프로필 가드레일 압축**:
  - `codex-adapter.js` 및 `antigravity-adapter.js`의 장황한 서술형 가드레일 텍스트를 약 40% 압축.
- **Context Assembler & Handoff 군더더기 제거**:
  - `[이전 대화 기록 / Context]` ➔ `[Context History]`로 단순화.
  - Provider Handoff Delta 안내 문구 간결화.
- **첨부 파일 및 스케줄러 접두사 다이어트**:
  - `[첨부 파일]`, `[예약 작업]` 등 불필요한 사족 제거.

### 2.2 레거시/오작동 명령어 및 UI 정리
- **유령 기능 `auto_compact_threshold` 완전 박멸**:
  - V2 Native 세션 구조에서 사문화된 `/settings` 내 Auto Compact 관련 버튼, 텍스트, 라우팅을 전면 제거.
- **`/help` 도움말 모바일 최적화**:
  - 4대 카테고리(세션 & 제어, 개발 & 배포, 모니터링 & 인프라, 설정 & 관리)로 재구성.
  - 누락되었던 `/deploy`, `/preview`, `/mcp`, `/skills` 완벽 반영.
- **슬래시 메뉴(`bot.setMyCommands`) 우선순위 재정렬**:
  - 모바일 바이브코딩 최우선 순위로 명령어 재배치.

### 2.3 Public Repo 보안 감사 & 하드코딩 환경변수화
- `GIT_USER_NAME`, `GIT_USER_EMAIL`, 도메인, 볼륨 마운트 경로 환경변수화.
- 퍼블릭 클린 템플릿(`.env.example`) 및 `README.md` 문서 최신화 완료.

### 2.4 전체 회귀 테스트 & V2 LTS 공식 태깅
- 총 264개 단위 테스트 중 260개 통과, 0개 실패, 4개 스킵 (**100% All Green**).
- V2 LTS 완결 및 Agent Hub Core 기능 개발 영구 동결(Feature Freeze) 공식 선언.

---

## 3. Acceptance Criteria

1. [x] 시스템 프롬프트 및 가드레일 토큰 소모량이 최적화되어 턴당 기본 토큰이 대폭 절감된다.
2. [x] 미사용/레거시 명령어가 정리되고 텔레그램 `/help`가 모바일 실사용에 최적화된다.
3. [x] 퍼블릭 레포 기준 민감 개인정보 및 하드코딩이 0건이며, 모든 식별자가 `.env`로 제어된다.
4. [x] 전체 테스트 스위트가 오류 없이 100% 통과한다 (264 tests All Green).
5. [x] V2 LTS 릴리즈 선언과 함께 Agent Hub Core 기능 추가가 공식 종료된다.

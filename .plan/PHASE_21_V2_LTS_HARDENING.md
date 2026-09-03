# Phase 21: V2 LTS Final Hardening & Optimization

## Status

`PLANNED`

## 1. 개요 및 최종 완결 목표

Phase 21은 Agent Hub Core의 기능 개발을 공식적으로 영구 동결(Feature Freeze)하고, 실전 모바일 바이브코딩을 위한 최종 장기 지원 버전(**V2 LTS**)으로 승격하는 완결 단계이다.

새로운 기능을 추가하지 않고, **토큰 다이어트, 레거시 정리, 퍼블릭 레포 보안 감사, 환경변수화**에 집중하여 코어를 가볍고 단단하게 굳힌다.

```text
  Phase 20 (Coolify Deploy & Voice STT)
                 ↓
  Phase 21: V2 LTS Final Hardening
    ├─ 1. 토큰 다이어트 (프롬프트/컨텍스트 최적화)
    ├─ 2. 레거시/오작동 명령어 및 기능 정리
    ├─ 3. Public Repo 보안 감사 및 하드코딩 환경변수화 (.env.example)
    └─ 4. 회귀 테스트 올그린 & Feature Freeze (V2 LTS 완결)
                 ↓
  🚀 Agent Hub Core 졸업 -> 실전 사이드프로젝트 개발 전념
```

---

## 2. 4대 중점 작업 영역

### 2.1 토큰 다이어트 (불필요한 토큰 소모 전면 차단)
- **시스템 프롬프트 & 가드레일 다이어트**:
  - 매 턴마다 Provider에 주입되는 가드레일, 실행 프로필 지침, 롤링 요약 포맷을 분석하여 불필요한 서술형 텍스트를 압축.
- **컨텍스트 어셈블리 군더더기 제거**:
  - Provider Native Session 전환 이후 사문화된 V1 컨텍스트 주입 찌꺼기가 남아있는지 점검하고 완전 제거.

### 2.2 레거시/오작동 명령어 및 미사용 기능 정리
- **명령어 전수 점검**:
  - Telegram에 등록된 명령어 중 V2 Native 세션 구조와 맞지 않거나, 유지보수 가치가 없는 불필요한 커맨드 정리.
- **도움말(`/help`) 및 메뉴 최적화**:
  - 모바일에서 직관적으로 필요한 핵심 명령어만 깔끔하게 남기도록 정리.

### 2.3 Public Repo 보안 감사 & 하드코딩 환경변수화
- **하드코딩 식별자 전면 환경변수 분리**:
  - `docker-compose.yml`, Dockerfile, 설정 파일에 하드코딩된 값(`GIT_NAME`, `GIT_EMAIL`, 특정 도메인, 개인 IP/포트 등)을 전면 `process.env`화.
- **퍼블릭 안전 템플릿(`.env.example`) 완성**:
  - 레포를 누구나 clone 받아도 개인정보 노출 위험이 전혀 없도록 보안 클린 상태 구축.
  - Secret/API Key 누출 방지 정밀 감사.

### 2.4 전체 회귀 테스트 & V2 LTS 공식 태깅
- 전체 단위/통합 테스트 스위트 100% Pass (All Green) 검증.
- `package.json` 버전 및 릴리즈 메타데이터 갱신.
- Git Tag `v2.0.0-lts` 생성 및 Core 기능 개발 영구 동결(Feature Freeze) 선언.

---

## 3. Acceptance Criteria

1. 시스템 프롬프트 및 가드레일 토큰 소모량이 최적화되어 턴당 기본 토큰이 대폭 절감된다.
2. 미사용/레거시 명령어가 정리되고 텔레그램 `/help`가 모바일 실사용에 최적화된다.
3. 퍼블릭 레포 기준 민감 개인정보 및 하드코딩이 0건이며, 모든 식별자가 `.env`로 제어된다.
4. 전체 테스트 스위트가 오류 없이 100% 통과한다.
5. V2 LTS 릴리즈 선언과 함께 Agent Hub Core 기능 추가가 공식 종료된다.

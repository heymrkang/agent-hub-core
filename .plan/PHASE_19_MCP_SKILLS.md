# Phase 19: Agent Extensibility — MCP & Skills

## Status

`DONE`

## 1. 개요 및 설계 원칙

Phase 19는 OpenAI Codex CLI와 Google Antigravity CLI의 확장 기능(MCP 및 Skills)을 Agent Hub에서 단일 마스터로 통합 관리하고, 두 Provider에 실시간 미러링 동기화(Dual Sync)하는 확장 아키텍처를 구현한다.

```text
       Telegram UI (/mcp, /skills)
                   ↓
   Agent Hub Canonical Master Store
   - DB: mcp_servers table
   - File: /data/skills/<name>/SKILL.md
                   ↓
      Dual Mirroring Sync Engine
         ├─ Codex Native Sync ──────> ~/.codex/config.toml & ~/.codex/skills/
         └─ Antigravity Native Sync > ~/.gemini/config/mcp_config.json & ~/.gemini/config/skills/
```

### 핵심 원칙
1. **Agent Hub Single Source of Truth**:
   - `/memory` 아키텍처와 동일하게, Agent Hub의 DB 및 `/data/skills`가 Canonical Master가 되며, 각 Provider 디렉토리는 실행용 미러(Execution Mirror)로 동작한다.
   - 컨테이너 재배포나 서버 재시작 시에도 `/data` 볼륨 마운트 데이터만 유지되면 기동 시점에 양쪽 Provider로 자동 동기화 복구된다.
2. **100% Provider-Agnostic 전역 동기화 (Global Scope)**:
   - 특정 Provider 전용 구분을 두지 않고, 등록된 MCP와 Skill은 모든 세션 및 두 Provider(Codex, Antigravity)에 동일하게 전역 적용된다.
   - 사용자가 `/model`로 모델을 전환해도 보유한 툴과 스킬이 그대로 유지된다.
3. **Secret 보호 (환경변수 매핑)**:
   - 텔레그램 채팅창에 민감한 API Key/Token을 직접 입력하지 않는다.
   - 서버 `.env` 또는 Coolify 환경변수 키 이름(예: `GITHUB_TOKEN`)만 매핑하고, 실행 시 프로세스 환경에서 주입한다.
4. **모바일 최적화 UX**:
   - 자주 쓰는 대표 MCP(GitHub, Fetch, DB, Memory 등) 원클릭 프리셋 버튼 제공.
   - 한 줄 복붙 커맨드(`/mcp add <name> <commandOrUrl> [--env KEY]`) 동시 지원.

---

## 2. 세부 데이터 모델 및 스토리지

### 2.1 DB 스키마 (`mcp_servers` 테이블)
```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command TEXT,
  args_json TEXT,
  url TEXT,
  env_keys_json TEXT, -- ['GITHUB_TOKEN', 'DB_PASSWORD'] 등 환경변수 이름 목록
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.2 Skills 스토리지 (`/data/skills/`)
- 디렉토리 구조:
  ```text
  /data/skills/
  └── <skill_name>/
      ├── SKILL.md (YAML Frontmatter: name, description)
      └── (scripts, resources...)
  ```
- 표준 `SKILL.md` 포맷을 준수하며, Progressive Disclosure(이름/설명 지연 로딩) 방식으로 동작.

---

## 3. Provider Dual-Sync 엔진 명세

### 3.1 Codex CLI 동기화
- **MCP**: `~/.codex/config.toml`의 `[mcp_servers.<name>]` 섹션 또는 `codex mcp` CLI 연동.
- **Skills**: `~/.codex/skills/<name>/` 디렉토리로 동기화(심링크 또는 복사).

### 3.2 Antigravity CLI (`agy`) 동기화
- **MCP**: `~/.gemini/config/mcp_config.json` 또는 `agy mcp add/remove/enable/disable` CLI 연동.
- **Skills**: `~/.gemini/config/skills/<name>/` 디렉토리로 동기화.

### 3.3 기동 시 부트스트랩 동기화
- Agent Hub 서버 부팅 시점에 `McpSyncService.syncAll()` 및 `SkillSyncService.syncAll()`을 실행하여, 파일시스템 불일치를 자동 복구.

---

## 4. 텔레그램 인터페이스 명세

### 4.1 `/mcp` 명령어
- **목록 화면**:
  - 등록된 MCP 서버 목록, 상태(● 활성 / ○ 비활성), Transport(stdio/http) 표시.
  - 인라인 버튼:
    - 각 서버 상세 버튼 (`[● github]`, `[○ fetch]`)
    - `[+ 프리셋 추가]` (GitHub, Fetch, SQLite/MariaDB, Memory 템플릿)
    - `[새로고침 / 재동기화]`
- **상세 화면**:
  - 실행 명령어/URL, 매핑된 환경변수 키 목록, 활성 상태.
  - 인라인 버튼: `[토글 켜기/끄기]`, `[삭제]`, `[‹ 목록]`
- **텍스트 커맨드**:
  - `/mcp add <name> <commandOrUrl> [--env KEY1,KEY2]`
  - `/mcp remove <name>`
  - `/mcp toggle <name>`

### 4.2 `/skills` 명령어
- **목록 화면**:
  - 등록된 Skill 이름, 설명, 활성 상태 목록 표시.
  - 인라인 버튼: `[새로고침 / 재동기화]`

---

## 5. 단계별 실행 계획

- [x] **19-1 데이터 계층 & 마이그레이션**: `016_mcp_servers.sql` 마이그레이션 및 Repository 구현 완료.
- [x] **19-2 Dual-Sync 엔진 구현**: Codex config/skills 및 Antigravity mcp_config/skills 양방향 동기화 모듈 구현 완료.
- [x] **19-3 Telegram UI & Handler**: `/mcp`, `/skills` 명령어 및 프리셋/상세/토글 인라인 키보드 구현 완료.
- [x] **19-4 서버 기동 시 자동 동기화**: `src/index.js` 부팅 시퀀스에 MCP/Skills 동기화 연동 완료.
- [x] **19-5 테스트 & 검증**: 단위 테스트 11건 추가 및 전체 248개 테스트 스위트 100% 통과 완료.

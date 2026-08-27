# Phase 11: System & Resource Observability

## Status

`PLANNED`

## 1. 목표

Phase 11은 Agent Hub Core가 실행되는 실제 Host의 시스템 리소스를 Telegram에서 안전하게 관찰하고 진단하는 기능을 구축한다.

대표 명령은 `/system`이다.

Phase 10 `/status`와 역할을 명확히 분리한다.

- `/status`: Agent Hub 기능/통합이 정상인가?
- `/system`: Host CPU/RAM/Disk/OS/Docker 리소스가 어떤 상태인가?

Phase 11 V1은 관찰/진단 중심이며 자동 삭제, 자동 restart, kill, prune 같은 destructive self-healing은 범위에서 제외한다.

---

## 2. System Collector

Telegram UI와 분리된 reusable collector/service를 만든다.

수집 실패는 항목별로 격리하며 한 metric 실패로 `/system` 전체가 실패하지 않는다.

### 2.1 Host

- Hostname
- OS / distribution
- Kernel
- Architecture
- Host uptime
- Agent Hub container uptime과 Host uptime을 혼동하지 않는다.

Host namespace에서 직접 얻기 어려운 값은 Docker host 접근 또는 안전한 host source를 사용하되, 실제 의미를 UI에 정확히 표시한다.

### 2.2 CPU

- Logical CPU/core count
- Current CPU usage %
- Load Average 1m / 5m / 15m
- Load 값과 CPU usage %를 같은 지표처럼 표현하지 않는다.

### 2.3 Memory

- Total
- Used
- Available
- Usage %
- 가능하면 Swap total/used
- Container memory와 Host memory를 구분한다.

### 2.4 Disk

최소 다음 persistent/critical filesystem의 capacity를 확인한다.

- Host root 또는 실제 Agent Hub data가 위치한 host filesystem
- `/data`
- `/workspace`

표시:

- Total
- Used
- Available
- Usage %

동일 underlying filesystem을 여러 mount가 가리키는 경우 UI에서 불필요한 중복을 줄인다.

### 2.5 Docker

Phase 9 DockerClient를 재사용/확장한다.

- Docker daemon version/state
- Running container count
- Stopped/exited container count
- 가능하면 unhealthy/restarting container count
- Agent Hub container 자체의 상태/리소스 식별

`/system` V1에서 전체 container log dump나 destructive control은 하지 않는다.

### 2.6 Agent Hub Process / Container

- Core process uptime
- Agent Hub container CPU usage
- Agent Hub container memory usage/limit
- 가능하면 container restart count

Host metric과 Agent Hub container metric을 별도 section으로 표시한다.

---

## 3. `/system` Telegram UI

Root 예시:

```text
System

Host
• Debian 12 / Linux 6.x
• Uptime: 4d 7h

CPU
• Usage: 13%
• Load: 0.42 / 0.31 / 0.25

Memory
• 3.8 GB / 16 GB (24%)

Disk
• 71 GB / 256 GB (28%)

Docker
• 13 running / 1 stopped
• 0 unhealthy

Agent Hub
• CPU: 1.2%
• RAM: 182 MB
```

Root는 빠른 overview로 유지하고 상세 정보가 많아지면 depth를 추가한다.

권장 submenu:

```text
[ CPU / Memory ]
[ Storage ]
[ Docker ]
[ Runtime ]
[ 새로고침 ]
```

Telegram message 길이와 button 난잡함을 피한다.

---

## 4. Resource Warning

Phase 11은 단순 숫자 나열을 넘어 명확한 warning level을 제공한다.

상태:

- `OK`
- `WARN`
- `CRITICAL`
- `UNKNOWN`

초기 기본 임계값 예시:

- Disk WARN >= 80%
- Disk CRITICAL >= 90%
- Memory WARN >= 85%
- Memory CRITICAL >= 95%
- CPU는 순간값만으로 CRITICAL 판정하지 않고 일정 sampling/window 또는 load와 함께 판단

실제 임계값은 구현 시 명시적으로 상수/설정으로 관리한다. 향후 Phase 10 settings와 연결 가능하게 설계한다.

### 4.1 Warning 표현

- NORMAL UI에서는 severity를 쉽게 구분한다.
- STEALTH UI에서도 의미가 사라지지 않도록 `[WARN]`, `[CRITICAL]` 등 text label을 유지한다.
- 단순 높은 cache 사용량 등 Linux에서 정상일 수 있는 값을 무조건 장애로 오판하지 않는다.

---

## 5. Refresh / Cache / 비용 제어

- `/system` 조회마다 무거운 shell command를 무제한 병렬 실행하지 않는다.
- 각 collector command에 timeout을 둔다.
- 짧은 TTL cache를 사용할 수 있다.
- Telegram `새로고침`은 stale message를 새 message로 계속 쌓기보다 가능하면 기존 status message를 edit한다.
- 동일 사용자의 과도한 연속 refresh에 기본 rate limit/debounce를 고려한다.

---

## 6. 안전 경계

Phase 11 `/system`은 기본적으로 read-only observability command다.

V1에서 제외:

- `docker rm`
- `docker prune`
- arbitrary process kill
- host reboot/shutdown
- filesystem delete
- automatic container restart
- automatic disk cleanup

사용자가 자연어 Agent를 통해 FULL_ACCESS로 인프라 작업을 수행하는 기존 Phase 9 경로와 `/system` UI 자체의 권한을 분리한다.

---

## 7. 구현 예상 구성

- `src/system/system-service.js`
- CPU/Memory/Disk/Host collectors
- DockerClient summary 확장
- Agent Hub container/process collector
- `src/telegram/commands/system.js`
- Resource severity evaluator
- optional short TTL cache
- Slash command menu 갱신
- Phase 10 Stealth renderer 재사용

파일명은 실제 구조에 맞춰 조정 가능하다.

---

## 8. Acceptance / E2E

- [ ] `/system`에서 Host OS/Kernel/Uptime을 확인할 수 있다.
- [ ] CPU usage/core/load average를 확인할 수 있다.
- [ ] Host Memory/Swap 상태를 확인할 수 있다.
- [ ] Disk capacity와 usage를 확인할 수 있다.
- [ ] Docker running/stopped/unhealthy summary를 확인할 수 있다.
- [ ] Agent Hub container/process resource를 Host resource와 구분해 표시한다.
- [ ] 일부 collector가 실패해도 나머지 system 정보가 표시된다.
- [ ] Resource threshold에 따라 OK/WARN/CRITICAL이 정확히 표시된다.
- [ ] `/system` 자체는 destructive operation을 수행하지 않는다.
- [ ] NORMAL/STEALTH UI 모두 의미가 유지된다.
- [ ] 반복 refresh가 Core에 과도한 command storm을 만들지 않는다.

## 9. 완료 조건

실제 Coolify Host에서 `/system`의 수치가 host terminal/Docker 측정값과 합리적으로 일치함을 검증하고 Phase 11 Audit에서 PASS 후 `DONE` 처리한다.

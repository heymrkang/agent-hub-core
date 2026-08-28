import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPreMigrationBackup } from './pre-migration-backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * DB 마이그레이션을 순차 적용한다.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dbPath
 * @param {string} backupDir
 */
export function runMigrations(db, dbPath, backupDir) {
  console.log('[Migrator] DB 마이그레이션 상태 확인 중...');

  // 1. schema_migrations 테이블 초기화
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 2. 이미 적용된 마이그레이션 버전 조회
  const appliedRows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const maxAppliedVersion = appliedRows.length > 0 ? Math.max(...appliedRows.map((r) => r.version)) : 0;

  // 3. migrations 디렉토리의 파일 목록 스캔
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((filename) => {
      const match = filename.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        throw new Error(`[Migrator] 올바르지 않은 마이그레이션 파일 형식: ${filename}`);
      }
      return {
        version: parseInt(match[1], 10),
        name: match[2],
        filename,
        filepath: path.join(MIGRATIONS_DIR, filename)
      };
    })
    .sort((a, b) => a.version - b.version);

  const maxCodeVersion = migrationFiles.length > 0 ? Math.max(...migrationFiles.map((m) => m.version)) : 0;

  // 4. DB 버전이 코드 버전보다 새로운 경우 (Startup Abort)
  if (maxAppliedVersion > maxCodeVersion) {
    console.error(
      `[Migrator Fatal] DB 스키마 버전(v${maxAppliedVersion})이 애플리케이션 지원 버전(v${maxCodeVersion})보다 높습니다. 기동을 중단합니다.`
    );
    process.exit(1);
  }

  // 5. 적용해야 할 신규 마이그레이션 필터링
  const pendingMigrations = migrationFiles.filter((m) => !appliedVersions.has(m.version));

  if (pendingMigrations.length === 0) {
    console.log(`[Migrator] DB 스키마가 최신 상태입니다 (v${maxAppliedVersion}).`);
    return;
  }

  console.log(`[Migrator] ${pendingMigrations.length}개의 신규 마이그레이션을 적용합니다.`);

  // 6. 마이그레이션 적용 전 안전 스냅샷 생성
  if (appliedRows.length > 0) {
    createPreMigrationBackup(db, dbPath, backupDir);
  }

  // 7. 각 마이그레이션을 순차적으로 트랜잭션 내에서 실행
  for (const migration of pendingMigrations) {
    console.log(`[Migrator] Applying v${migration.version}: ${migration.name}...`);
    const sqlContent = fs.readFileSync(migration.filepath, 'utf8');

    const applyMigrationTx = db.transaction(() => {
      db.exec(sqlContent);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
    });

    try {
      applyMigrationTx();
      console.log(`[Migrator] Successfully applied v${migration.version}: ${migration.name}`);
    } catch (err) {
      console.error(
        `[Migrator Fatal] 마이그레이션 적용 실패 (v${migration.version} - ${migration.name}): ${err.message}`
      );
      process.exit(1);
    }
  }

  console.log('[Migrator] 모든 마이그레이션 적용 완료.');
}

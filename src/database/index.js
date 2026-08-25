import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrator.js';

let dbInstance = null;

/**
 * SQLite 데이터베이스를 초기화하고 마이그레이션을 실행한다.
 * @returns {Database.Database}
 */
export function initDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'agent-hub.db');
  const backupDir = path.join(dataDir, 'backups', 'migrations');

  console.log(`[Database] SQLite 데이터베이스 연결: ${dbPath}`);

  try {
    const db = new Database(dbPath, {
      timeout: 5000 // Busy timeout 5초
    });

    // 성능 및 동시성 최적화: WAL 모드 및 Foreign Key 활성화
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 마이그레이션 실행
    runMigrations(db, dbPath, backupDir);

    dbInstance = db;
    return dbInstance;
  } catch (error) {
    console.error(`[Database Fatal] 데이터베이스 초기화 실패: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 현재 활성화된 데이터베이스 인스턴스를 반환한다.
 * @returns {Database.Database}
 */
export function getDb() {
  if (!dbInstance) {
    throw new Error('데이터베이스가 아직 초기화되지 않았습니다. initDatabase()를 먼저 호출하세요.');
  }
  return dbInstance;
}

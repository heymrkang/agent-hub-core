import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * 마이그레이션 실행 직전 DB 파일의 안전한 스냅샷을 생성한다.
 *
 * Agent Hub는 WAL 모드를 사용하므로 메인 .db 파일만 바로 복사하면
 * 아직 WAL에 남아 있는 커밋이 누락될 수 있다. 시작 단계에서는 단일
 * Agent Hub DB 연결만 존재하므로 FULL checkpoint 후 standalone DB 파일을
 * 복사하고, 복사본 자체에 PRAGMA quick_check를 수행한다.
 *
 * @param {import('better-sqlite3').Database} db 열린 SQLite 연결
 * @param {string} dbPath SQLite 데이터베이스 파일 경로
 * @param {string} backupDir 백업 디렉토리 경로 (기본: /data/backups/migrations)
 * @returns {string|null} 생성된 백업 파일 경로 또는 스킵 시 null
 */
export function createPreMigrationBackup(db, dbPath, backupDir) {
  if (!fs.existsSync(dbPath)) {
    // 신규 DB인 경우 백업할 필요 없음
    return null;
  }

  const stat = fs.statSync(dbPath);
  if (stat.size === 0) {
    return null;
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `pre_migration_${timestamp}.db`;
  const backupFilePath = path.join(backupDir, backupFileName);

  try {
    // WAL에 남아 있는 committed page를 메인 DB에 반영한 뒤 복사한다.
    db.pragma('wal_checkpoint(FULL)');
    fs.copyFileSync(dbPath, backupFilePath);

    // 스냅샷이 독립적으로 열리고 정상 DB인지 즉시 검증한다.
    const snapshot = new Database(backupFilePath, { readonly: true, fileMustExist: true });
    try {
      const result = snapshot.pragma('quick_check', { simple: true });
      if (result !== 'ok') {
        throw new Error(`PRAGMA quick_check 실패: ${result}`);
      }
    } finally {
      snapshot.close();
    }

    console.log(`[Database] Pre-migration 안전 스냅샷 생성 완료: ${backupFilePath}`);
    return backupFilePath;
  } catch (error) {
    try { fs.rmSync(backupFilePath, { force: true }); } catch {}
    console.error(`[Database Error] Pre-migration 스냅샷 생성 실패: ${error.message}`);
    throw error;
  }
}

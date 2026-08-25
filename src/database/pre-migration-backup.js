import fs from 'fs';
import path from 'path';

/**
 * 마이그레이션 실행 직전 DB 파일의 안전한 스냅샷을 생성한다.
 * @param {string} dbPath SQLite 데이터베이스 파일 경로
 * @param {string} backupDir 백업 디렉토리 경로 (기본: /data/backups/migrations)
 * @returns {string|null} 생성된 백업 파일 경로 또는 스킵 시 null
 */
export function createPreMigrationBackup(dbPath, backupDir) {
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
    fs.copyFileSync(dbPath, backupFilePath);
    console.log(`[Database] Pre-migration 안전 스냅샷 생성 완료: ${backupFilePath}`);
    return backupFilePath;
  } catch (error) {
    console.error(`[Database Error] Pre-migration 스냅샷 생성 실패: ${error.message}`);
    throw error;
  }
}

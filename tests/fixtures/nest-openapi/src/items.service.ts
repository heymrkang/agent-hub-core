import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface Item {
  id: number;
  name: string;
}

const PREVIEW_TABLE = 'phase17_preview_items';

function selectDatabaseUrl(): string | null {
  const raw = String(process.env.DATABASE_URL || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!['mariadb:', 'mysql:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') return null;
  if (parsed.search || parsed.hash || parsed.username.includes(',')) return null;
  return parsed.toString();
}

@Injectable()
export class ItemsService implements OnModuleDestroy {
  private readonly items: Item[] = [];
  private nextId = 1;
  private readonly databaseUrl = selectDatabaseUrl();
  private poolPromise: Promise<Pool> | null = null;
  private schemaReady = false;

  async findAll(): Promise<Item[]> {
    const pool = await this.getPool();
    if (pool) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM ${PREVIEW_TABLE} ORDER BY id`);
      return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
    }
    return this.items.map((item) => ({ ...item }));
  }

  async create(name: string): Promise<Item> {
    const pool = await this.getPool();
    if (pool) {
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO ${PREVIEW_TABLE}(name) VALUES (?)`,
        [name]
      );
      return { id: result.insertId, name };
    }
    const item = { id: this.nextId++, name };
    this.items.push(item);
    return { ...item };
  }

  async update(id: number, name: string | undefined): Promise<Item> {
    const pool = await this.getPool();
    if (pool) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, name FROM ${PREVIEW_TABLE} WHERE id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length) throw new NotFoundException(`item ${id} not found`);
      const nextName = name === undefined ? String(rows[0].name) : name;
      await pool.execute(`UPDATE ${PREVIEW_TABLE} SET name = ? WHERE id = ?`, [nextName, id]);
      return { id, name: nextName };
    }
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundException(`item ${id} not found`);
    if (name !== undefined) item.name = name;
    return { ...item };
  }

  async remove(id: number): Promise<Item> {
    const pool = await this.getPool();
    if (pool) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, name FROM ${PREVIEW_TABLE} WHERE id = ? LIMIT 1`,
        [id]
      );
      if (!rows.length) throw new NotFoundException(`item ${id} not found`);
      await pool.execute(`DELETE FROM ${PREVIEW_TABLE} WHERE id = ?`, [id]);
      return { id: Number(rows[0].id), name: String(rows[0].name) };
    }
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new NotFoundException(`item ${id} not found`);
    return this.items.splice(index, 1)[0];
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.poolPromise) return;
    const pool = await this.poolPromise;
    await pool.end();
  }

  private async getPool(): Promise<Pool | null> {
    if (!this.databaseUrl) return null;
    if (!this.poolPromise) {
      this.poolPromise = this.createDatabasePool();
    }
    return this.poolPromise;
  }

  private async createDatabasePool(): Promise<Pool> {
    if (!this.databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }
    const pool = createPool(this.databaseUrl);
    if (!this.schemaReady) {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS ${PREVIEW_TABLE} (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      this.schemaReady = true;
    }
    return pool;
  }
}

import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPool, Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface Item {
  id: number;
  name: string;
}

@Injectable()
export class ItemsService implements OnModuleInit, OnModuleDestroy {
  private readonly items: Item[] = [];
  private nextId = 1;
  private pool: Pool | null = null;

  async onModuleInit(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    const target = new URL(databaseUrl);
    this.pool = createPool({
      host: target.hostname,
      port: target.port ? Number.parseInt(target.port, 10) : 3306,
      user: decodeURIComponent(target.username),
      password: decodeURIComponent(target.password),
      database: decodeURIComponent(target.pathname.replace(/^\//, '')),
      connectionLimit: 3,
      charset: 'utf8mb4'
    });
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS phase17_preview_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async findAll(): Promise<Item[]> {
    if (this.pool) {
      const [rows] = await this.pool.query<(Item & RowDataPacket)[]>(
        'SELECT id, name FROM phase17_preview_items ORDER BY id'
      );
      return rows.map(({ id, name }) => ({ id, name }));
    }
    return this.items.map((item) => ({ ...item }));
  }

  async create(name: string): Promise<Item> {
    if (this.pool) {
      const [result] = await this.pool.execute<ResultSetHeader>(
        'INSERT INTO phase17_preview_items(name) VALUES (?)',
        [name]
      );
      return { id: result.insertId, name };
    }
    const item = { id: this.nextId++, name };
    this.items.push(item);
    return { ...item };
  }

  async update(id: number, name: string | undefined): Promise<Item> {
    if (this.pool) {
      const [result] = await this.pool.execute<ResultSetHeader>(
        'UPDATE phase17_preview_items SET name=COALESCE(?, name) WHERE id=?',
        [name ?? null, id]
      );
      if (result.affectedRows === 0) throw new NotFoundException(`item ${id} not found`);
      const [rows] = await this.pool.query<(Item & RowDataPacket)[]>(
        'SELECT id, name FROM phase17_preview_items WHERE id=?',
        [id]
      );
      return { id: rows[0].id, name: rows[0].name };
    }
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundException(`item ${id} not found`);
    if (name !== undefined) item.name = name;
    return { ...item };
  }

  async remove(id: number): Promise<Item> {
    if (this.pool) {
      const [rows] = await this.pool.query<(Item & RowDataPacket)[]>(
        'SELECT id, name FROM phase17_preview_items WHERE id=?',
        [id]
      );
      if (!rows[0]) throw new NotFoundException(`item ${id} not found`);
      await this.pool.execute('DELETE FROM phase17_preview_items WHERE id=?', [id]);
      return { id: rows[0].id, name: rows[0].name };
    }
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new NotFoundException(`item ${id} not found`);
    return this.items.splice(index, 1)[0];
  }
}

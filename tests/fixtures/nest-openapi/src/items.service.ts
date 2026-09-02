import { Injectable, NotFoundException } from '@nestjs/common';

export interface Item {
  id: number;
  name: string;
}

@Injectable()
export class ItemsService {
  private readonly items: Item[] = [];
  private nextId = 1;

  async findAll(): Promise<Item[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async create(name: string): Promise<Item> {
    const item = { id: this.nextId++, name };
    this.items.push(item);
    return { ...item };
  }

  async update(id: number, name: string | undefined): Promise<Item> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundException(`item ${id} not found`);
    if (name !== undefined) item.name = name;
    return { ...item };
  }

  async remove(id: number): Promise<Item> {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new NotFoundException(`item ${id} not found`);
    return this.items.splice(index, 1)[0];
  }
}

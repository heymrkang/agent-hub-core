import { Injectable, NotFoundException } from '@nestjs/common';

export interface Item {
  id: number;
  name: string;
}

@Injectable()
export class ItemsService {
  private readonly items: Item[] = [];
  private nextId = 1;

  findAll(): Item[] {
    return this.items.map((item) => ({ ...item }));
  }

  create(name: string): Item {
    const item = { id: this.nextId++, name };
    this.items.push(item);
    return { ...item };
  }

  update(id: number, name: string | undefined): Item {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundException(`item ${id} not found`);
    if (name !== undefined) item.name = name;
    return { ...item };
  }

  remove(id: number): Item {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index === -1) throw new NotFoundException(`item ${id} not found`);
    return this.items.splice(index, 1)[0];
  }
}

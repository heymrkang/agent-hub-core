import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Sse,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Observable, of } from 'rxjs';
import { Item, ItemsService } from './items.service';

class ItemBody {
  @ApiProperty({ example: 'alpha', required: false })
  name?: string;
}

@ApiTags('fixture')
@Controller()
export class AppController {
  constructor(private readonly items: ItemsService) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('items')
  findAll(): Promise<Item[]> {
    return this.items.findAll();
  }

  @Post('items')
  create(@Body() body: ItemBody): Promise<Item> {
    return this.items.create(body.name ?? 'unnamed');
  }

  @Patch('items/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: ItemBody): Promise<Item> {
    return this.items.update(id, body.name);
  }

  @Delete('items/:id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.items.remove(id);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } }
    }
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File): Record<string, unknown> {
    return {
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size
    };
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return of({ data: { status: 'ready' }, type: 'fixture' } as MessageEvent);
  }
}

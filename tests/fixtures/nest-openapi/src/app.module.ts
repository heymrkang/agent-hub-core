import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ItemsService } from './items.service';

@Module({
  controllers: [AppController],
  providers: [ItemsService]
})
export class AppModule {}

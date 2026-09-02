import 'reflect-metadata';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  const address = app.getHttpServer().address() as AddressInfo;
  console.log(`FIXTURE_READY:http://127.0.0.1:${address.port}`);
}

void bootstrap();

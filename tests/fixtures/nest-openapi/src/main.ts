import 'reflect-metadata';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Agent Hub NestJS Fixture')
    .setDescription('Backend Preview OpenAPI fixture')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  const address = app.getHttpServer().address() as AddressInfo;
  console.log(`FIXTURE_READY:http://127.0.0.1:${address.port}`);
}

void bootstrap();

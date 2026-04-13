import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { json, text, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase payload size for file uploads
  app.use(json({ limit: '50mb' }));
  app.use(text({ type: 'text/plain', limit: '50mb' }));

  // Some clients (e.g. Postman raw Text) may send JSON as text/plain.
  // Parse it so validation receives a proper object payload.
  app.use((req, _res, next) => {
    if (req.is('text/plain') && typeof req.body === 'string') {
      const raw = req.body.trim();
      const seemsJson =
        (raw.startsWith('{') && raw.endsWith('}')) ||
        (raw.startsWith('[') && raw.endsWith(']'));

      if (seemsJson) {
        try {
          req.body = JSON.parse(raw) as unknown;
        } catch {
          // Leave as-is. Validation pipe will return INVALID_PAYLOAD.
        }
      }
    }
    next();
  });

  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = errors.map((e) => ({
          field: e.property,
          messages: e.constraints ? Object.values(e.constraints) : ['Invalid value'],
        }));

        return new BadRequestException({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Du lieu gui len khong hop le',
            details,
          },
        });
      },
    }),
  );

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Zalo Chat API')
    .setDescription('Backend NestJS + MongoDB Atlas (Mongoose)')
    .setVersion('1.0')
    .addTag('Users', 'Người dùng — collection users')
    .addTag('Sessions', 'Phiên đăng nhập — collection sessions')
    .addTag('Friendships', 'Kết bạn — collection friendships')
    .addTag('Conversations', 'Hội thoại — collection conversations')
    .addTag('Messages', 'Tin nhắn — collection messages')
    .addTag('Calls', 'Cuộc gọi thoại / video — collection calls')
    .addTag('Notifications', 'Thông báo — collection notifications')
    .addTag('Stories', 'Zalo Story — collection stories')
    .addTag('Reports (Admin)', 'Báo cáo vi phạm — collection reports')
    .addTag('Seed', 'Dữ liệu mẫu — chỉ dev / SEED_HTTP=true')
    .addTag('Auth', 'Đăng ký / đăng nhập / OTP / JWT')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 8081;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase payload size for file uploads
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Enable CORS
app.enableCors({
  origin: true, // Cho phép mọi cổng (62015, 65190, v.v.) gọi tới
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: true,
});

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
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
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 8081;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api`);
}
bootstrap();

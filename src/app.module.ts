import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SessionsModule } from './sessions/sessions.module';
import { FriendshipsModule } from './friendships/friendships.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { CallsModule } from './calls/calls.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StoriesModule } from './stories/stories.module';
import { ReportsModule } from './reports/reports.module';
import { SeedModule } from './seed/seed.module';
import { getMongoConfig } from './config/mongo.config';
import { UploadModule } from './upload/upload.module';
import { AuthModule } from './auth/auth.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { OptionalAccessSessionGuard } from './auth/guards/optional-access-session.guard';
import { RealtimeModule } from './realtime/realtime.module';
@Module({
  imports: [
    RealtimeModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getMongoConfig,
      inject: [ConfigService],
    }),
    UsersModule,
    SessionsModule,
    FriendshipsModule,
    ConversationsModule,
    MessagesModule,
    CallsModule,
    NotificationsModule,
    StoriesModule,
    ReportsModule,
    SeedModule,
    UploadModule,
    AuthModule,
    ChatbotModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: OptionalAccessSessionGuard,
    },
  ],
})
export class AppModule {}

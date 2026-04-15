import { Module } from '@nestjs/common';
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
@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

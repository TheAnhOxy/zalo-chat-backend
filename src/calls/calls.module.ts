import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Call, CallSchema } from './schemas/call.schema';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { CallsGateway } from './gateways/calls.gateway';
import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Call.name, schema: CallSchema }]),
    ConversationsModule,
    NotificationsModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
  exports: [CallsService, MongooseModule],
})
export class CallsModule {}

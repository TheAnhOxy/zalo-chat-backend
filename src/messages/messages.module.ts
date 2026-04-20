import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from './schemas/message.schema';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './gateways/messages.gateway';
import { UsersModule } from 'src/users/users.module'; 
import { ConversationsModule } from '../conversations/conversations.module'; 
import { FriendshipsModule } from '../friendships/friendships.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    UsersModule,           // Giữ lại để MessagesGateway xử lý được join_user_room và online status
    ConversationsModule,   // Giữ lại để xử lý các logic liên quan đến hội thoại
    FriendshipsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesService, MongooseModule],
})
export class MessagesModule {}
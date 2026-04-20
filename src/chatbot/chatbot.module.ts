import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { FriendshipsModule } from '../friendships/friendships.module';
import { UsersModule } from '../users/users.module';
import { Friendship, FriendshipSchema } from '../friendships/schemas/friendship.schema';
import {
  ChatbotConversation,
  ChatbotConversationSchema,
} from './schemas/chatbot-conversation.schema';
import {
  ChatbotMessage,
  ChatbotMessageSchema,
} from './schemas/chatbot-message.schema';

@Module({
  imports: [
    FriendshipsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: ChatbotConversation.name, schema: ChatbotConversationSchema },
      { name: ChatbotMessage.name, schema: ChatbotMessageSchema },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}

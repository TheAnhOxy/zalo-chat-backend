import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { FriendshipsModule } from '../friendships/friendships.module';
import { UsersModule } from '../users/users.module';
import {
  Friendship,
  FriendshipSchema,
} from '../friendships/schemas/friendship.schema';
import {
  ChatbotConversation,
  ChatbotConversationSchema,
} from './schemas/chatbot-conversation.schema';
import {
  ChatbotMessage,
  ChatbotMessageSchema,
} from './schemas/chatbot-message.schema';
import {
  Conversation,
  ConversationSchema,
} from '../conversations/schemas/conversation.schema';
import { Message, MessageSchema } from '../messages/schemas/message.schema';

@Module({
  imports: [
    FriendshipsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: ChatbotConversation.name, schema: ChatbotConversationSchema },
      { name: ChatbotMessage.name, schema: ChatbotMessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}

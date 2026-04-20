import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChatbotConversationDocument = HydratedDocument<ChatbotConversation>;

@Schema({ collection: 'chatbot_conversations', timestamps: true })
export class ChatbotConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: 'Cuộc trò chuyện mới' })
  title: string;

  @Prop({ type: Date, default: () => new Date(), index: true })
  lastMessageAt: Date;
}

export const ChatbotConversationSchema =
  SchemaFactory.createForClass(ChatbotConversation);

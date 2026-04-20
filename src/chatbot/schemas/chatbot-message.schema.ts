import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChatbotMessageDocument = HydratedDocument<ChatbotMessage>;

export type ChatbotRole = 'user' | 'assistant' | 'system';

@Schema({ _id: false })
export class ChatbotAttachment {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: true })
  mimeType: string;
}
export const ChatbotAttachmentSchema =
  SchemaFactory.createForClass(ChatbotAttachment);

@Schema({ collection: 'chatbot_messages', timestamps: true })
export class ChatbotMessage {
  @Prop({
    type: Types.ObjectId,
    ref: 'ChatbotConversation',
    required: true,
    index: true,
  })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  role: ChatbotRole;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({ type: [ChatbotAttachmentSchema], default: [] })
  attachments: ChatbotAttachment[];

  @Prop({ type: [String], default: [] })
  toolsUsed: string[];
}

export const ChatbotMessageSchema = SchemaFactory.createForClass(ChatbotMessage);


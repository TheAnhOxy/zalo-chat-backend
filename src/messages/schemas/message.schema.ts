import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  FILE = 'FILE',
  VOICE = 'VOICE',
  LOCATION = 'LOCATION',
  CONTACT = 'CONTACT',
  SYSTEM = 'SYSTEM',
}

export enum MessageStatus {
  SENDING = 'SENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  SEEN = 'SEEN',
}

export enum ReactionType {
  LIKE = 'LIKE',
  LOVE = 'LOVE',
  HAHA = 'HAHA',
  WOW = 'WOW',
  SAD = 'SAD',
  ANGRY = 'ANGRY',
}

@Schema({ _id: false })
export class MessageMetadata {
  @Prop({ type: String, default: '' })
  fileName: string;

  @Prop({ type: Number, default: null })
  fileSize: number | null;

  @Prop({ type: String, default: '' })
  thumbnail: string;

  @Prop({ type: Number, default: null })
  lat: number | null;

  @Prop({ type: Number, default: null })
  lng: number | null;

  @Prop({ type: Number, default: null })
  duration: number | null;
}
export const MessageMetadataMongoSchema =
  SchemaFactory.createForClass(MessageMetadata);

@Schema({ _id: false })
export class MessageReaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ReactionType),
    required: true,
  })
  reactionType: ReactionType; // Đã đổi tên để tránh xung đột
}
export const MessageReactionMongoSchema =
  SchemaFactory.createForClass(MessageReaction);

@Schema({ _id: false })
export class MessageSeenBy {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  seenAt: Date;
}
export const MessageSeenByMongoSchema =
  SchemaFactory.createForClass(MessageSeenBy);

@Schema({
  collection: 'messages',
  timestamps: true,
})
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(MessageType),
    required: true,
    alias: 'type',
  })
  messageType: MessageType;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({
    type: MessageMetadataMongoSchema,
    default: () => ({}),
  })
  metadata: MessageMetadata;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  replyTo: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(MessageStatus),
    default: MessageStatus.SENDING,
  })
  status: MessageStatus;

  @Prop({ type: Boolean, default: false })
  isRecalled: boolean;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  deletedBy: Types.ObjectId[];

  @Prop({
    type: [MessageReactionMongoSchema],
    default: [],
  })
  reactions: MessageReaction[];

  @Prop({
    type: [MessageSeenByMongoSchema],
    default: [],
  })
  seenBy: MessageSeenBy[];

  // ── Pinned message ──────────────────────────────────────────────────────────
  @Prop({ type: Boolean, default: false })
  isPinned: boolean;

  @Prop({ type: Date, default: null })
  pinnedAt: Date | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, senderId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, status: 1, createdAt: -1 });
MessageSchema.index(
  { replyTo: 1 },
  {
    partialFilterExpression: {
      replyTo: { $exists: true, $ne: null },
    },
  },
);
MessageSchema.index({ conversationId: 1, isRecalled: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, isPinned: 1, pinnedAt: -1 });

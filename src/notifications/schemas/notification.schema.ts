import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  MESSAGE = 'MESSAGE',
  FRIEND_REQUEST = 'FRIEND_REQUEST',
  FRIEND_ACCEPTED = 'FRIEND_ACCEPTED',
  CALL = 'CALL',
  STORY = 'STORY',
  MESSAGE_REACTION = 'MESSAGE_REACTION',
}

@Schema({ _id: false })
export class NotificationData {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  senderId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', default: null })
  conversationId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  messageId: Types.ObjectId | null;
}
export const NotificationDataMongoSchema =
  SchemaFactory.createForClass(NotificationData);

@Schema({
  collection: 'notifications',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  receiverId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(NotificationType),
    required: true,
  })
  type: NotificationType;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({
    type: NotificationDataMongoSchema,
    default: () => ({
      senderId: null,
      conversationId: null,
      messageId: null,
    }),
  })
  data: NotificationData;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ receiverId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ receiverId: 1, createdAt: -1 });
NotificationSchema.index({ receiverId: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ 'data.conversationId': 1, createdAt: -1 });

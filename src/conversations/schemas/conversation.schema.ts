import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

export enum ConversationType {
  PRIVATE = 'PRIVATE',
  GROUP = 'GROUP',
}

export enum ConversationMemberRole {
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  MEMBER = 'MEMBER',
}

@Schema({ _id: false })
export class ConversationMember {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ConversationMemberRole),
    default: ConversationMemberRole.MEMBER,
  })
  role: ConversationMemberRole;

  @Prop({ type: String, default: '' })
  nickname: string;

  @Prop({ type: Date, default: () => new Date() })
  joinedAt: Date;

  @Prop({ type: Boolean, default: false })
  isMuted: boolean;

  @Prop({ type: Boolean, default: false })
  isPinned: boolean;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  @Prop({ type: String, default: '' })
  hiddenPin: string;
}
export const ConversationMemberMongoSchema =
  SchemaFactory.createForClass(ConversationMember);

@Schema({ _id: false })
export class LastMessage {
  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  messageId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}
export const LastMessageMongoSchema =
  SchemaFactory.createForClass(LastMessage);

@Schema({ _id: false })
export class GroupSettings {
  @Prop({ type: Boolean, default: true })
  allowInviteLink: boolean;

  @Prop({ type: String, default: '' })
  joinQrCode: string;

  @Prop({ type: Boolean, default: false })
  isLockChat: boolean;
}
export const GroupSettingsMongoSchema =
  SchemaFactory.createForClass(GroupSettings);

@Schema({
  collection: 'conversations',
  timestamps: true,
})
export class Conversation {
  @Prop({
    type: String,
    enum: Object.values(ConversationType),
    required: true,
  })
  type: ConversationType;

  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: String, default: '' })
  avatar: string;

  @Prop({
    type: [ConversationMemberMongoSchema],
    default: [],
  })
  members: ConversationMember[];

  @Prop({
    type: LastMessageMongoSchema,
    default: null,
  })
  lastMessage: LastMessage | null;

  @Prop({
    type: GroupSettingsMongoSchema,
    default: () => ({
      allowInviteLink: true,
      joinQrCode: '',
      isLockChat: false,
    }),
  })
  groupSettings: GroupSettings;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ 'members.userId': 1, updatedAt: -1 });
ConversationSchema.index({ type: 1, updatedAt: -1 });

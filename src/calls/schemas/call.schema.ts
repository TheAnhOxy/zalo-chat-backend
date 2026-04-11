import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CallDocument = HydratedDocument<Call>;

export enum CallType {
  VOICE = 'VOICE',
  VIDEO = 'VIDEO',
}

export enum CallStatus {
  CALLING = 'CALLING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  MISSED = 'MISSED',
  ENDED = 'ENDED',
}

@Schema({
  collection: 'calls',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Call {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  callerId: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  participants: Types.ObjectId[];

  @Prop({
    type: String,
    enum: Object.values(CallType),
    required: true,
  })
  type: CallType;

  @Prop({
    type: String,
    enum: Object.values(CallStatus),
    default: CallStatus.CALLING,
  })
  status: CallStatus;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;

  /** Thời lượng cuộc gọi (giây) */
  @Prop({ type: Number, default: 0 })
  duration: number;
}

export const CallSchema = SchemaFactory.createForClass(Call);

CallSchema.index({ conversationId: 1, createdAt: -1 });
CallSchema.index({ callerId: 1, createdAt: -1 });
CallSchema.index({ participants: 1, createdAt: -1 });
CallSchema.index({ status: 1, createdAt: -1 });
CallSchema.index({ conversationId: 1, status: 1, createdAt: -1 });

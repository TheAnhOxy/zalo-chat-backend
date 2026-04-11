import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

export enum SessionDevice {
  WEB = 'web',
  ANDROID = 'android',
  IOS = 'ios',
}

@Schema({
  collection: 'sessions',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(SessionDevice),
    required: true,
  })
  device: SessionDevice;

  @Prop({ type: String, required: true, trim: true })
  deviceName: string;

  @Prop({ type: String, required: true, trim: true })
  ip: string;

  @Prop({ type: String, required: true })
  refreshToken: string;

  @Prop({ type: Date, required: true })
  expiredAt: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.index({ refreshToken: 1 }, { unique: true });
SessionSchema.index({ userId: 1, isActive: 1 });
SessionSchema.index({ userId: 1, device: 1 });
SessionSchema.index({ userId: 1, createdAt: -1 });
SessionSchema.index({ expiredAt: 1, isActive: 1 });

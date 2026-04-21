import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpSessionDocument = HydratedDocument<OtpSession>;

export enum OtpPurpose {
  REGISTER = 'register',
  FORGOT_PASSWORD = 'forgot_password',
  LOGIN_PHONE = 'login_phone',
  LOGIN_NEW_DEVICE = 'login_new_device',
}

@Schema({
  collection: 'otp_sessions',
  timestamps: { createdAt: true, updatedAt: false },
})
export class OtpSession {
  @Prop({ type: String, required: true, unique: true })
  sessionId: string;

  @Prop({ type: String, enum: Object.values(OtpPurpose), required: true })
  purpose: OtpPurpose;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, required: true, select: false })
  otpHash: string;

  @Prop({ type: Date, required: true })
  otpExpiredAt: Date;

  @Prop({ type: Date, required: true })
  resendAllowedAt: Date;

  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;
}

export const OtpSessionSchema = SchemaFactory.createForClass(OtpSession);

OtpSessionSchema.index({ email: 1, purpose: 1, createdAt: -1 });
OtpSessionSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
OtpSessionSchema.index({ otpExpiredAt: 1 }, { expireAfterSeconds: 86400 });

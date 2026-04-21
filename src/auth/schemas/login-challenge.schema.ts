import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SessionDevice } from '../../sessions/schemas/session.schema';

export type LoginChallengeDocument = HydratedDocument<LoginChallenge>;

export enum LoginChallengeStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CONSUMED = 'consumed',
}

@Schema({
  collection: 'login_challenges',
  timestamps: { createdAt: true, updatedAt: false },
})
export class LoginChallenge {
  @Prop({ type: String, required: true, unique: true })
  challengeId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  email: string;

  @Prop({ type: String, enum: Object.values(SessionDevice), required: true })
  device: SessionDevice;

  @Prop({ type: String, required: true })
  deviceName: string;

  @Prop({ type: String, required: true })
  ip: string;

  @Prop({
    type: String,
    enum: Object.values(LoginChallengeStatus),
    default: LoginChallengeStatus.PENDING,
  })
  status: LoginChallengeStatus;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: Date, default: null })
  rejectedAt: Date | null;

  @Prop({ type: Date, default: null })
  consumedAt: Date | null;
}

export const LoginChallengeSchema = SchemaFactory.createForClass(LoginChallenge);

LoginChallengeSchema.index({ userId: 1, createdAt: -1 });
LoginChallengeSchema.index({ status: 1, createdAt: -1 });
LoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

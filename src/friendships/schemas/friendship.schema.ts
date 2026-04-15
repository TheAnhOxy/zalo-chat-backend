import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
}

@Schema({
  collection: 'friendships',
  timestamps: true,
})
export class Friendship {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  addresseeId: Types.ObjectId;

  /**
   * Dùng để chống trùng quan hệ theo cặp user (không phân biệt chiều).
   * Format: "<minObjectId>:<maxObjectId>"
   */
  @Prop({ type: String, required: true })
  pairKey: string;

  @Prop({
    type: String,
    enum: Object.values(FriendshipStatus),
    default: FriendshipStatus.PENDING,
  })
  status: FriendshipStatus;

  @Prop({ type: Date, default: null })
  respondedAt: Date | null;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

FriendshipSchema.pre('validate', function () {
  const requesterId = this.requesterId?.toString?.() || '';
  const addresseeId = this.addresseeId?.toString?.() || '';
  const [a, b] = [requesterId, addresseeId].sort();
  this.pairKey = `${a}:${b}`;
});

FriendshipSchema.index({ pairKey: 1 }, { unique: true });
FriendshipSchema.index({ requesterId: 1, addresseeId: 1 });
FriendshipSchema.index({ addresseeId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ status: 1, createdAt: -1 });

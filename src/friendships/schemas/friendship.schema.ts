import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FriendshipDocument = HydratedDocument<Friendship>;

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  BLOCKED = 'BLOCKED',
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

  @Prop({
    type: String,
    enum: Object.values(FriendshipStatus),
    default: FriendshipStatus.PENDING,
  })
  status: FriendshipStatus;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

FriendshipSchema.index(
  { requesterId: 1, addresseeId: 1 },
  { unique: true },
);

FriendshipSchema.index({ addresseeId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
FriendshipSchema.index({ status: 1, createdAt: -1 });

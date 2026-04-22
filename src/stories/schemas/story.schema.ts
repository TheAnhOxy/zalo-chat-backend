import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StoryDocument = HydratedDocument<Story>;

export enum StoryMediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

@Schema({
  collection: 'stories',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Story {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  mediaUrl: string;

  @Prop({
    type: String,
    enum: Object.values(StoryMediaType),
    required: true,
  })
  type: StoryMediaType;

  @Prop({ type: String, default: '' })
  caption: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  viewers: Types.ObjectId[];

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: String })
  thumbnailUrl?: string;
}

export const StorySchema = SchemaFactory.createForClass(Story);

StorySchema.index({ userId: 1, createdAt: -1 });
StorySchema.index({ userId: 1, expiresAt: 1 });
StorySchema.index({ viewers: 1, createdAt: -1 });

/** Xóa document sau khi qua expiresAt (TTL ~60s/lần quét) */
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

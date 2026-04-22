import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Story, StoryDocument } from './schemas/story.schema';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { toPlainDoc } from '../common/mongo-plain';

/** Chuyển lean document (plain JS object) sang Record chuẩn hóa: _id → string */
function leanToPlain(doc: any): Record<string, unknown> {
  const plain: any = { ...doc };
  if (plain._id) plain._id = plain._id.toString();
  if (plain.userId && typeof plain.userId === 'object') {
    if (plain.userId._id) {
      // populated
      plain.userName = plain.userId.fullName;
      plain.userAvatar = plain.userId.avatar;
      plain.userId = plain.userId._id.toString();
    } else {
      plain.userId = plain.userId.toString();
    }
  }
  if (Array.isArray(plain.viewers)) {
    plain.viewers = plain.viewers.map((v: any) =>
      typeof v === 'object' ? v.toString() : v,
    );
  }
  return plain as Record<string, unknown>;
}

@Injectable()
export class StoriesService {
  constructor(
    @InjectModel(Story.name) private storyModel: Model<StoryDocument>,
  ) {}

  async create(dto: CreateStoryDto): Promise<Record<string, unknown>> {
    const doc = new this.storyModel({
      userId: new Types.ObjectId(dto.userId),
      mediaUrl: dto.mediaUrl,
      type: dto.type,
      caption: dto.caption ?? '',
      viewers: (dto.viewers ?? []).map((id) => new Types.ObjectId(id)),
      expiresAt: new Date(dto.expiresAt),
    });

    const saved = await doc.save();
    const populated = await saved.populate('userId', 'fullName avatar');
    const plain = toPlainDoc(populated) as any;
    if (populated.userId && typeof populated.userId === 'object') {
      plain.userId = (populated.userId as any)._id.toString();
      plain.userName = (populated.userId as any).fullName;
      plain.userAvatar = (populated.userId as any).avatar;
    }
    return plain;
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.storyModel
      .find()
      .populate('userId', 'fullName avatar')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return list.map(leanToPlain);
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy story');
    }
    const row = await this.storyModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy story');
    }
    return row as Record<string, unknown>;
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; skip?: number; activeOnly?: boolean },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (options?.activeOnly) {
      filter.expiresAt = { $gt: new Date() };
    }

    const list = await this.storyModel
      .find(filter)
      .populate('userId', 'fullName avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list.map(leanToPlain);
  }

  async findExplore(userId: string, limit = 20): Promise<Record<string, unknown>[]> {
    const list = await this.storyModel
      .find({
        userId: { $ne: new Types.ObjectId(userId) },
        expiresAt: { $gt: new Date() },
      })
      .populate('userId', 'fullName avatar')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return list.map(leanToPlain);
  }

  async update(id: string, dto: UpdateStoryDto): Promise<Record<string, unknown>> {
    const doc = await this.storyModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy story');
    }

    if (dto.mediaUrl !== undefined) doc.mediaUrl = dto.mediaUrl;
    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.caption !== undefined) doc.caption = dto.caption;
    if (dto.expiresAt !== undefined) doc.expiresAt = new Date(dto.expiresAt);
    if (dto.viewers !== undefined) {
      doc.viewers = dto.viewers.map((x) => new Types.ObjectId(x));
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  async addViewer(storyId: string, viewerId: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(storyId) || !Types.ObjectId.isValid(viewerId)) {
      throw new NotFoundException('Không tìm thấy story');
    }
    const doc = await this.storyModel.findByIdAndUpdate(
      storyId,
      { $addToSet: { viewers: new Types.ObjectId(viewerId) } },
      { new: true },
    );
    if (!doc) {
      throw new NotFoundException('Không tìm thấy story');
    }
    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.storyModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy story');
    }
  }
}

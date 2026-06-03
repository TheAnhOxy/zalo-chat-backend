import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Story, StoryDocument } from './schemas/story.schema';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { toPlainDoc } from '../common/mongo-plain';
import { FriendshipsService } from '../friendships/friendships.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';

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
  if (plain.thumbnailUrl) plain.thumbnailUrl = plain.thumbnailUrl.toString();
  return plain as Record<string, unknown>;
}

@Injectable()
export class StoriesService {
  constructor(
    @InjectModel(Story.name) private storyModel: Model<StoryDocument>,
    private readonly friendshipsService: FriendshipsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateStoryDto): Promise<Record<string, unknown>> {
    const doc = new this.storyModel({
      userId: new Types.ObjectId(dto.userId),
      mediaUrl: dto.mediaUrl,
      type: dto.type,
      caption: dto.caption ?? '',
      viewers: (dto.viewers ?? []).map((id) => new Types.ObjectId(id)),
      expiresAt: new Date(dto.expiresAt),
      thumbnailUrl: dto.thumbnailUrl,
    });

    const saved = await doc.save();
    const populated = await saved.populate('userId', 'fullName avatar');
    const plain = toPlainDoc(populated) as any;
    if (populated.userId && typeof populated.userId === 'object') {
      plain.userId = (populated.userId as any)._id.toString();
      plain.userName = (populated.userId as any).fullName;
      plain.userAvatar = (populated.userId as any).avatar;
    }
    
    // Gửi thông báo đến bạn bè
    try {
      const friendIds = await this.friendshipsService.findAcceptedFriendIdsByUserId(dto.userId);
      for (const friendId of friendIds) {
        await this.notificationsService.create({
          receiverId: friendId,
          type: NotificationType.STORY,
          content: 'vừa đăng một tin mới',
          data: { senderId: dto.userId },
          isRead: false,
        });
      }
    } catch (e) {
      // Ignore error
    }

    return plain;
  }

  async findAll(currentUserId?: string): Promise<Record<string, unknown>[]> {
    if (!currentUserId || !Types.ObjectId.isValid(currentUserId)) {
      return [];
    }

    const friendIds = await this.friendshipsService.findAcceptedFriendIdsByUserId(currentUserId);
    const validUserIds = [currentUserId, ...friendIds].map((id) => new Types.ObjectId(id));

    const list = await this.storyModel
      .find({
        userId: { $in: validUserIds },
        expiresAt: { $gt: new Date() },
      })
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

  async getStoryFeed(userId: string): Promise<any[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    
    // 1. Get friend list + me
    const friendIds = await this.friendshipsService.findAcceptedFriendIdsByUserId(userId);
    const validUserIds = [userId, ...friendIds].map((id) => new Types.ObjectId(id));
    
    // 2. Aggregate query
    const now = new Date();
    const groups = await this.storyModel.aggregate([
      // $match userId in validUserIds and expiresAt > now
      {
        $match: {
          userId: { $in: validUserIds },
          expiresAt: { $gt: now },
        },
      },
      // $sort by createdAt ASC inside the group
      { $sort: { createdAt: 1 } },
      // $group by userId
      {
        $group: {
          _id: '$userId',
          stories: { $push: '$$ROOT' },
          lastStoryTime: { $last: '$createdAt' },
        },
      },
      // Lookup user populate
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Sort groups by lastStoryTime DESC
      { $sort: { lastStoryTime: -1 } },
    ]);

    // 3. Format the response
    return groups.map((g) => {
      // Map stories to normal output formatting
      const plainStories = g.stories.map((s: any) => {
        const p = { ...s };
        p._id = p._id.toString();
        p.userId = p.userId.toString();
        if (p.viewers) {
          p.viewers = p.viewers.map((v: any) => v.toString());
        }
        return p;
      });

      const user = g.userDetails
        ? {
            id: g.userDetails._id.toString(),
            fullName: g.userDetails.fullName,
            avatar: g.userDetails.avatar,
          }
        : { id: g._id.toString() };

      const hasUnseen = plainStories.some(
        (s: any) => !(s.viewers || []).includes(userId),
      );

      return {
        user,
        hasUnseen,
        lastStoryTime: g.lastStoryTime,
        stories: plainStories,
      };
    });
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
    if (dto.thumbnailUrl !== undefined) doc.thumbnailUrl = dto.thumbnailUrl;
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

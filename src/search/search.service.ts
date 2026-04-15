import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { FriendshipsService } from '../friendships/friendships.service';
import { BlocksService } from '../blocks/blocks.service';

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly friendshipsService: FriendshipsService,
    private readonly blocksService: BlocksService,
  ) {}

  async searchUsers(
    meId: string,
    params: { q: string; limit?: number; cursor?: string },
  ) {
    const q = (params.q || '').trim();
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    if (!Types.ObjectId.isValid(meId)) {
      return { items: [], nextCursor: null };
    }

    if (!q) {
      return { items: [], nextCursor: null };
    }

    const me = new Types.ObjectId(meId);

    // Exclude blocked users (either direction)
    const blockedIds =
      await this.blocksService.listBlockedUserIdsEitherWay(meId);

    // Search by phone/email exact-ish, otherwise fullName fuzzy.
    const or: Record<string, unknown>[] = [];
    if (/^\+?\d{6,15}$/.test(q)) {
      or.push({ phone: { $regex: `^${this.escapeRegex(q)}` } });
    }
    if (q.includes('@')) {
      or.push({ email: { $regex: `^${this.escapeRegex(q)}`, $options: 'i' } });
    }
    or.push({ fullName: { $regex: this.escapeRegex(q), $options: 'i' } });

    const query: Record<string, unknown> = {
      _id: {
        $ne: me,
        ...(blockedIds.length
          ? { $nin: blockedIds.map((x) => new Types.ObjectId(x)) }
          : {}),
      },
      isBlocked: false,
      $or: or,
    };

    if (params.cursor) {
      query.createdAt = { $lt: new Date(params.cursor) };
    }

    const raw = await this.userModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('fullName phone email avatar status privacy isVerified createdAt')
      .lean()
      .exec();

    // Filter out already-friends or pending requests (either direction)
    const candidateIds = raw.map((u) =>
      String((u as { _id: Types.ObjectId })._id),
    );
    const relationMap = await this.friendshipsService.getRelationshipMap(
      meId,
      candidateIds,
    );
    const items = raw.filter((u) => {
      const id = String((u as { _id: Types.ObjectId })._id);
      const rel = relationMap.get(id) || 'none';
      return rel === 'none';
    });

    const nextCursor =
      raw.length === limit
        ? new Date(
            (raw[raw.length - 1] as unknown as { createdAt: Date }).createdAt,
          ).toISOString()
        : null;

    return { items: items as Record<string, unknown>[], nextCursor };
  }

  private escapeRegex(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { FriendshipsService } from '../friendships/friendships.service';
import { BlocksService } from '../blocks/blocks.service';

@Injectable()
export class SuggestedFriendsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly friendshipsService: FriendshipsService,
    private readonly blocksService: BlocksService,
  ) {}

  async suggestedFriends(meId: string, params: { limit?: number }) {
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    if (!Types.ObjectId.isValid(meId)) return { items: [] };

    const myFriendIds = await this.friendshipsService.listFriendIds(meId);
    const excluded = new Set<string>([meId, ...myFriendIds]);

    // Exclude pending (either direction) too
    const relMap = await this.friendshipsService.getRelationshipMap(
      meId,
      myFriendIds,
    );
    for (const [id, status] of relMap.entries()) {
      if (status !== 'none') excluded.add(id);
    }

    // Exclude blocked
    const blockedIds =
      await this.blocksService.listBlockedUserIdsEitherWay(meId);
    for (const id of blockedIds) excluded.add(id);

    // Friends-of-friends candidates with mutual count
    const counts = new Map<string, number>();
    for (const fid of myFriendIds.slice(0, 200)) {
      const fof = await this.friendshipsService.listFriendIds(fid);
      for (const c of fof) {
        if (excluded.has(c)) continue;
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }

    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    const ids = sorted.map(([id]) => id);
    if (!ids.length) return { items: [] };

    const users = await this.userModel
      .find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } })
      .select('fullName avatar status')
      .lean()
      .exec();

    const map = new Map(
      users.map((u) => [String((u as { _id: Types.ObjectId })._id), u]),
    );
    const items = ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((u) => ({
        ...(u as Record<string, unknown>),
        mutualCount:
          counts.get(String((u as { _id: Types.ObjectId })._id)) || 0,
      }));

    return { items };
  }
}

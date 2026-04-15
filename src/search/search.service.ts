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
    params: {
      q: string;
      limit?: number;
      cursor?: string;
      includeRelated?: boolean;
    },
  ) {
    const q = (params.q || '').trim();
    const qCompact = q.replace(/\s+/g, ' ');
    const qNoAccent = this.removeVietnameseTones(qCompact).toLowerCase();
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    if (!Types.ObjectId.isValid(meId)) {
      return { items: [], nextCursor: null };
    }

    if (!qCompact) {
      return { items: [], nextCursor: null };
    }

    const me = new Types.ObjectId(meId);

    // Exclude blocked users (either direction)
    const blockedIds =
      await this.blocksService.listBlockedUserIdsEitherWay(meId);

    // Search by phone/email exact-ish, otherwise fullName fuzzy.
    const or: Record<string, unknown>[] = [];
    if (/^\+?\d{6,15}$/.test(qCompact)) {
      or.push({ phone: { $regex: `^${this.escapeRegex(qCompact)}` } });
    }
    if (qCompact.includes('@')) {
      or.push({
        email: { $regex: `^${this.escapeRegex(qCompact)}`, $options: 'i' },
      });
    }
    or.push({
      fullName: {
        // Match both with/without Vietnamese accents.
        $regex: this.buildVietnameseInsensitiveRegex(qCompact),
        $options: 'i',
      },
    });

    const idFilter: Record<string, unknown> = {
      ...(blockedIds.length
        ? { $nin: blockedIds.map((x) => new Types.ObjectId(x)) }
        : {}),
    };
    // In general add-friend search should hide myself.
    // For global name search (includeRelated=true), allow showing my own account.
    if (!params.includeRelated) {
      idFilter.$ne = me;
    }

    const query: Record<string, unknown> = {
      _id: idFilter,
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

    let items = raw;
    if (!params.includeRelated) {
      // Add-friend mode: hide users that are already related.
      const candidateIds = raw.map((u) =>
        String((u as { _id: Types.ObjectId })._id),
      );
      const relationMap = await this.friendshipsService.getRelationshipMap(
        meId,
        candidateIds,
      );
      items = raw.filter((u) => {
        const id = String((u as { _id: Types.ObjectId })._id);
        const rel = relationMap.get(id) || 'none';
        return rel === 'none';
      });
    }

    // Final accent-insensitive guard to ensure robust matching.
    // Useful when users type without dấu but DB stores fullName with dấu.
    items = items.filter((u) => {
      const fullName = String((u as { fullName?: string }).fullName || '');
      const normalizedName = this
        .removeVietnameseTones(fullName)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      return normalizedName.includes(qNoAccent);
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

  private removeVietnameseTones(input: string) {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  private buildVietnameseInsensitiveRegex(input: string) {
    const map: Record<string, string> = {
      a: 'aàáạảãâầấậẩẫăằắặẳẵ',
      e: 'eèéẹẻẽêềếệểễ',
      i: 'iìíịỉĩ',
      o: 'oòóọỏõôồốộổỗơờớợởỡ',
      u: 'uùúụủũưừứựửữ',
      y: 'yỳýỵỷỹ',
      d: 'dđ',
    };
    let out = '';
    for (const ch of input.toLowerCase().split('')) {
      if (ch.trim().length === 0) {
        out += '\\s+';
        continue;
      }
      const group = map[ch];
      if (group != null) {
        out += `[${this.escapeRegex(group)}]`;
      } else {
        out += this.escapeRegex(ch);
      }
    }
    return out;
  }
}

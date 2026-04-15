import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Friendship,
  FriendshipDocument,
  FriendshipStatus,
} from './schemas/friendship.schema';
import { CreateFriendshipDto } from './dto/create-friendship.dto';
import { UpdateFriendshipDto } from './dto/update-friendship.dto';
import { toPlainDoc } from '../common/mongo-plain';
import { BlocksService } from '../blocks/blocks.service';

@Injectable()
export class FriendshipsService {
  constructor(
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    private readonly blocksService: BlocksService,
  ) {}

  async create(dto: CreateFriendshipDto): Promise<Record<string, unknown>> {
    if (dto.requesterId === dto.addresseeId) {
      throw new BadRequestException(
        'requesterId và addresseeId không được trùng',
      );
    }

    try {
      const doc = new this.friendshipModel({
        requesterId: new Types.ObjectId(dto.requesterId),
        addresseeId: new Types.ObjectId(dto.addresseeId),
        status: FriendshipStatus.PENDING,
        respondedAt: null,
      });
      const saved = await doc.save();
      return toPlainDoc(saved);
    } catch (err: unknown) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException(
          'Đã tồn tại quan hệ với cặp requesterId / addresseeId này',
        );
      }
      throw err;
    }
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.friendshipModel.find().lean().exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    const row = await this.friendshipModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    return row as Record<string, unknown>;
  }

  /** Mọi bản ghi mà user là người gửi hoặc người nhận */
  async findByUserId(userId: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const oid = new Types.ObjectId(userId);
    const list = await this.friendshipModel
      .find({
        $or: [{ requesterId: oid }, { addresseeId: oid }],
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  async update(
    id: string,
    dto: UpdateFriendshipDto,
  ): Promise<Record<string, unknown>> {
    await this.findById(id);
    const row = await this.friendshipModel
      .findByIdAndUpdate(
        id,
        { $set: { status: dto.status, respondedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    return row as Record<string, unknown>;
  }

  async remove(id: string): Promise<void> {
    const res = await this.friendshipModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    );
  }

  // ===== V1 API (auth required) =====

  async sendRequest(meId: string, targetUserId: string) {
    this.assertValidTwoUsers(meId, targetUserId);

    if (await this.blocksService.isBlockedEitherWay(meId, targetUserId)) {
      throw new ForbiddenException('Blocked');
    }

    const existing = await this.friendshipModel
      .findOne({
        pairKey: this.pairKey(meId, targetUserId),
      })
      .lean()
      .exec();

    if (existing) {
      return existing as Record<string, unknown>;
    }

    try {
      const doc = await this.friendshipModel.create({
        requesterId: new Types.ObjectId(meId),
        addresseeId: new Types.ObjectId(targetUserId),
        status: FriendshipStatus.PENDING,
        respondedAt: null,
      });
      return toPlainDoc(doc);
    } catch (err: unknown) {
      if (this.isDuplicateKeyError(err)) {
        const row = await this.friendshipModel
          .findOne({ pairKey: this.pairKey(meId, targetUserId) })
          .lean()
          .exec();
        if (row) return row as Record<string, unknown>;
      }
      throw err;
    }
  }

  async listInboundRequests(meId: string) {
    if (!Types.ObjectId.isValid(meId)) return [];
    const me = new Types.ObjectId(meId);
    const rows = await this.friendshipModel
      .find({ addresseeId: me, status: FriendshipStatus.PENDING })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return rows as Record<string, unknown>[];
  }

  async listOutboundRequests(meId: string) {
    if (!Types.ObjectId.isValid(meId)) return [];
    const me = new Types.ObjectId(meId);
    const rows = await this.friendshipModel
      .find({ requesterId: me, status: FriendshipStatus.PENDING })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return rows as Record<string, unknown>[];
  }

  async acceptRequest(meId: string, requestId: string) {
    if (!Types.ObjectId.isValid(meId) || !Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    const row = await this.friendshipModel.findById(requestId).exec();
    if (!row) throw new NotFoundException('Không tìm thấy friendship');

    if (row.status !== FriendshipStatus.PENDING) {
      return toPlainDoc(row);
    }
    if (row.addresseeId.toString() !== meId) {
      throw new ForbiddenException('Not allowed');
    }
    if (
      await this.blocksService.isBlockedEitherWay(
        meId,
        row.requesterId.toString(),
      )
    ) {
      throw new ForbiddenException('Blocked');
    }

    row.status = FriendshipStatus.ACCEPTED;
    row.respondedAt = new Date();
    await row.save();
    return toPlainDoc(row);
  }

  async declineRequest(meId: string, requestId: string) {
    if (!Types.ObjectId.isValid(meId) || !Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    const row = await this.friendshipModel.findById(requestId).exec();
    if (!row) throw new NotFoundException('Không tìm thấy friendship');

    if (row.addresseeId.toString() !== meId) {
      throw new ForbiddenException('Not allowed');
    }
    if (row.status !== FriendshipStatus.PENDING) {
      return toPlainDoc(row);
    }

    row.status = FriendshipStatus.DECLINED;
    row.respondedAt = new Date();
    await row.save();
    return toPlainDoc(row);
  }

  async cancelRequest(meId: string, requestId: string) {
    if (!Types.ObjectId.isValid(meId) || !Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    const row = await this.friendshipModel.findById(requestId).exec();
    if (!row) throw new NotFoundException('Không tìm thấy friendship');
    if (row.requesterId.toString() !== meId) {
      throw new ForbiddenException('Not allowed');
    }
    if (row.status !== FriendshipStatus.PENDING) {
      return;
    }
    row.status = FriendshipStatus.CANCELLED;
    row.respondedAt = new Date();
    await row.save();
  }

  async listFriends(
    meId: string,
    params: { cursor?: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(meId)) {
      return { items: [], nextCursor: null };
    }

    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    const me = new Types.ObjectId(meId);

    const query: Record<string, unknown> = {
      status: FriendshipStatus.ACCEPTED,
      $or: [{ requesterId: me }, { addresseeId: me }],
    };

    if (params.cursor) {
      query.createdAt = { $lt: new Date(params.cursor) };
    }

    const items = await this.friendshipModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const nextCursor =
      items.length === limit
        ? new Date(
            (items[items.length - 1] as unknown as { createdAt: Date })
              .createdAt,
          ).toISOString()
        : null;

    return { items: items as Record<string, unknown>[], nextCursor };
  }

  async getRelationship(
    meId: string,
    otherId: string,
  ): Promise<Record<string, unknown>> {
    this.assertValidTwoUsers(meId, otherId);

    const blockDirection = await this.blocksService.getBlockDirection(
      meId,
      otherId,
    );
    if (blockDirection === 'a_blocks_b') return { status: 'blocked' };
    if (blockDirection === 'b_blocks_a') return { status: 'blocked_by_other' };

    const row = await this.friendshipModel
      .findOne({ pairKey: this.pairKey(meId, otherId) })
      .lean()
      .exec();
    if (!row) return { status: 'none' };

    const requesterId = String((row as { requesterId: unknown }).requesterId);
    const addresseeId = String((row as { addresseeId: unknown }).addresseeId);
    const rawStatus = (row as { status: unknown }).status;
    const status: FriendshipStatus | null =
      typeof rawStatus === 'string' &&
      (Object.values(FriendshipStatus) as string[]).includes(rawStatus)
        ? (rawStatus as FriendshipStatus)
        : null;

    if (status === FriendshipStatus.ACCEPTED) return { status: 'friends' };
    if (status === FriendshipStatus.PENDING) {
      if (addresseeId === meId) return { status: 'pending_in' };
      if (requesterId === meId) return { status: 'pending_out' };
    }

    return { status: 'none' };
  }

  private assertValidTwoUsers(a: string, b: string) {
    if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b)) {
      throw new BadRequestException('Invalid user id');
    }
    if (a === b) {
      throw new BadRequestException('Invalid target user');
    }
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  /**
   * Batch relationship lookup between me and many userIds.
   * Returns: 'friends' | 'pending_in' | 'pending_out' | 'none'
   */
  async getRelationshipMap(
    meId: string,
    otherUserIds: string[],
  ): Promise<Map<string, 'friends' | 'pending_in' | 'pending_out' | 'none'>> {
    const out = new Map<
      string,
      'friends' | 'pending_in' | 'pending_out' | 'none'
    >();
    if (!Types.ObjectId.isValid(meId)) return out;

    const ids = Array.from(
      new Set(
        otherUserIds.filter((x) => Types.ObjectId.isValid(x) && x !== meId),
      ),
    );
    if (!ids.length) return out;

    const keys = ids.map((id) => this.pairKey(meId, id));
    const rows = await this.friendshipModel
      .find({ pairKey: { $in: keys } })
      .lean()
      .exec();

    for (const id of ids) {
      out.set(id, 'none');
    }

    for (const r of rows as Array<{
      requesterId: Types.ObjectId;
      addresseeId: Types.ObjectId;
      status: FriendshipStatus;
      pairKey: string;
    }>) {
      const requesterId = r.requesterId.toString();
      const addresseeId = r.addresseeId.toString();
      const otherId = requesterId === meId ? addresseeId : requesterId;

      if (r.status === FriendshipStatus.ACCEPTED) {
        out.set(otherId, 'friends');
      } else if (r.status === FriendshipStatus.PENDING) {
        if (addresseeId === meId) out.set(otherId, 'pending_in');
        else if (requesterId === meId) out.set(otherId, 'pending_out');
      } else {
        out.set(otherId, 'none');
      }
    }

    return out;
  }

  async listFriendIds(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const me = new Types.ObjectId(userId);
    const rows = await this.friendshipModel
      .find({
        status: FriendshipStatus.ACCEPTED,
        $or: [{ requesterId: me }, { addresseeId: me }],
      })
      .select('requesterId addresseeId')
      .lean()
      .exec();

    const ids = new Set<string>();
    for (const r of rows as Array<{
      requesterId: Types.ObjectId;
      addresseeId: Types.ObjectId;
    }>) {
      const a = r.requesterId.toString();
      const b = r.addresseeId.toString();
      ids.add(a === userId ? b : a);
    }
    ids.delete(userId);
    return Array.from(ids);
  }
}

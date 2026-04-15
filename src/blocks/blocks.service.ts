import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Block, BlockDocument } from './schemas/block.schema';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class BlocksService {
  constructor(
    @InjectModel(Block.name) private readonly blockModel: Model<BlockDocument>,
  ) {}

  async list(blockerId: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(blockerId)) return [];
    return (await this.blockModel
      .find({ blockerId: new Types.ObjectId(blockerId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as Record<string, unknown>[];
  }

  async block(
    blockerId: string,
    blockedId: string,
  ): Promise<Record<string, unknown>> {
    if (
      !Types.ObjectId.isValid(blockerId) ||
      !Types.ObjectId.isValid(blockedId)
    ) {
      throw new BadRequestException('Invalid user id');
    }
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }
    try {
      const doc = await this.blockModel.create({
        blockerId: new Types.ObjectId(blockerId),
        blockedId: new Types.ObjectId(blockedId),
      });
      return toPlainDoc(doc);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        throw new ConflictException('Already blocked');
      }
      throw err;
    }
  }

  async listBlockedUserIdsEitherWay(meId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(meId)) return [];
    const me = new Types.ObjectId(meId);
    const rows = await this.blockModel
      .find({ $or: [{ blockerId: me }, { blockedId: me }] })
      .lean()
      .exec();

    const ids = new Set<string>();
    for (const r of rows as Array<{
      blockerId: Types.ObjectId;
      blockedId: Types.ObjectId;
    }>) {
      ids.add(r.blockerId.toString());
      ids.add(r.blockedId.toString());
    }
    ids.delete(meId);
    return Array.from(ids);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    if (
      !Types.ObjectId.isValid(blockerId) ||
      !Types.ObjectId.isValid(blockedId)
    ) {
      throw new BadRequestException('Invalid user id');
    }
    const res = await this.blockModel
      .deleteOne({
        blockerId: new Types.ObjectId(blockerId),
        blockedId: new Types.ObjectId(blockedId),
      })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('Block not found');
    }
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b)) return false;
    const ao = new Types.ObjectId(a);
    const bo = new Types.ObjectId(b);
    const found = await this.blockModel
      .exists({
        $or: [
          { blockerId: ao, blockedId: bo },
          { blockerId: bo, blockedId: ao },
        ],
      })
      .exec();
    return !!found;
  }

  async getBlockDirection(
    a: string,
    b: string,
  ): Promise<'none' | 'a_blocks_b' | 'b_blocks_a'> {
    if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b)) return 'none';
    const ao = new Types.ObjectId(a);
    const bo = new Types.ObjectId(b);
    const aBlocksB = await this.blockModel
      .exists({ blockerId: ao, blockedId: bo })
      .exec();
    if (aBlocksB) return 'a_blocks_b';
    const bBlocksA = await this.blockModel
      .exists({ blockerId: bo, blockedId: ao })
      .exec();
    if (bBlocksA) return 'b_blocks_a';
    return 'none';
  }
}

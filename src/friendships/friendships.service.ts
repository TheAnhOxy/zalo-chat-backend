import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Friendship, FriendshipDocument, FriendshipStatus } from './schemas/friendship.schema';
import { CreateFriendshipDto } from './dto/create-friendship.dto';
import { UpdateFriendshipDto } from './dto/update-friendship.dto';
import { toPlainDoc } from '../common/mongo-plain';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';

@Injectable()
export class FriendshipsService {
  constructor(
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    private notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateFriendshipDto): Promise<Record<string, unknown>> {
    if (dto.requesterId === dto.addresseeId) {
      throw new BadRequestException('requesterId và addresseeId không được trùng');
    }

    try {
      const doc = new this.friendshipModel({
        requesterId: new Types.ObjectId(dto.requesterId),
        addresseeId: new Types.ObjectId(dto.addresseeId),
        status: FriendshipStatus.PENDING,
      });
      const saved = await doc.save();
      
      // Tạo thông báo kết bạn
      await this.notificationsService.create({
        receiverId: dto.addresseeId,
        type: NotificationType.FRIEND_REQUEST,
        content: 'đã gửi cho bạn một lời mời kết bạn',
        data: { senderId: dto.requesterId },
        isRead: false,
      });
      
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

  async findAcceptedFriendIdsByUserId(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    const oid = new Types.ObjectId(userId);
    const rows = await this.friendshipModel
      .find({
        status: FriendshipStatus.ACCEPTED,
        $or: [{ requesterId: oid }, { addresseeId: oid }],
      })
      .select('requesterId addresseeId')
      .lean()
      .exec();

    const friendIds = new Set<string>();
    for (const row of rows) {
      const requesterId = String(row.requesterId);
      const addresseeId = String(row.addresseeId);
      if (requesterId !== userId) {
        friendIds.add(requesterId);
      }
      if (addresseeId !== userId) {
        friendIds.add(addresseeId);
      }
    }

    return Array.from(friendIds);
  }

  async update(
    id: string,
    dto: UpdateFriendshipDto,
  ): Promise<Record<string, unknown>> {
    const oldRow = await this.findById(id);
    const row = await this.friendshipModel
      .findByIdAndUpdate(id, { $set: { status: dto.status } }, { new: true })
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy friendship');
    }
    
    if (dto.status === FriendshipStatus.ACCEPTED && oldRow.status !== FriendshipStatus.ACCEPTED) {
      const requesterIdStr = String(oldRow.requesterId);
      const addresseeIdStr = String(oldRow.addresseeId);
      
      // Tạo thông báo cho người đã gửi lời mời (requester)
      await this.notificationsService.create({
        receiverId: requesterIdStr,
        type: NotificationType.FRIEND_ACCEPTED as any, // ép kiểu nếu mongoose ts chưa catch kịp
        content: 'đã chấp nhận lời mời kết bạn của bạn',
        data: { senderId: addresseeIdStr },
        isRead: false,
      });
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
}

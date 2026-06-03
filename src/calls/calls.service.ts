import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Call, CallDocument, CallStatus } from './schemas/call.schema';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { toPlainDoc } from '../common/mongo-plain';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';

@Injectable()
export class CallsService {
  constructor(
    @InjectModel(Call.name) private callModel: Model<CallDocument>,
    private notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateCallDto): Promise<Record<string, unknown>> {
    const doc = new this.callModel({
      conversationId: new Types.ObjectId(dto.conversationId),
      callerId: new Types.ObjectId(dto.callerId),
      participants: dto.participants.map((id) => new Types.ObjectId(id)),
      type: dto.type,
      status: dto.status ?? CallStatus.CALLING,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
      duration: dto.duration ?? 0,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.callModel.find().sort({ createdAt: -1 }).lean().exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy call');
    }
    const row = await this.callModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy call');
    }
    return row as Record<string, unknown>;
  }

  async findByConversationId(
    conversationId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      return [];
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.callModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const uid = new Types.ObjectId(userId);
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.callModel
      .find({
        $or: [{ callerId: uid }, { participants: uid }],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async update(id: string, dto: UpdateCallDto): Promise<Record<string, unknown>> {
    const updateData: any = {};

    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.startedAt !== undefined) {
      updateData.startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    }
    if (dto.endedAt !== undefined) {
      updateData.endedAt = dto.endedAt ? new Date(dto.endedAt) : null;
    }
    if (dto.duration !== undefined) updateData.duration = dto.duration;
    if (dto.participants !== undefined) {
      updateData.participants = dto.participants.map((x) => new Types.ObjectId(x));
    }
    if (dto.activeParticipants !== undefined) {
      updateData.activeParticipants = dto.activeParticipants.map((x) => new Types.ObjectId(x));
    }

    // ✅ Dùng findByIdAndUpdate để avoid Mongoose version conflict
    const doc = await this.callModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .exec();

    if (!doc) {
      throw new NotFoundException('Không tìm thấy call');
    }

    // Cuộc gọi nhỡ: khi bị từ chối (REJECTED) HOẶC kết thúc trước khi có ai nhấc máy (ENDED + duration=0)
    const isMissedCall =
      dto.status === CallStatus.REJECTED ||
      (dto.status === CallStatus.ENDED && doc.duration === 0);

    if (isMissedCall) {
      // Tạo thông báo cuộc gọi nhỡ cho phía người nghe (các participants trừ caller)
      for (const participantId of doc.participants) {
        if (participantId.toString() !== doc.callerId.toString()) {
          await this.notificationsService.create({
            receiverId: participantId.toString(),
            type: NotificationType.CALL,
            content: 'Bạn có một cuộc gọi nhỡ',
            data: {
              senderId: doc.callerId.toString(),
              conversationId: doc.conversationId.toString(),
            },
            isRead: false,
          });
        }
      }
    }

    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.callModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy call');
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationData,
} from './schemas/notification.schema';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { NotificationDataDto } from './dto/notification-data.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Record<string, unknown>> {
    const doc = new this.notificationModel({
      receiverId: new Types.ObjectId(dto.receiverId),
      type: dto.type,
      content: dto.content ?? '',
      data: this.mapData(dto.data),
      isRead: dto.isRead ?? false,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.notificationModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy notification');
    }
    const row = await this.notificationModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy notification');
    }
    return row as Record<string, unknown>;
  }

  async findByReceiverId(
    receiverId: string,
    options?: { limit?: number; skip?: number; unreadOnly?: boolean },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(receiverId)) {
      return [];
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const filter: Record<string, unknown> = {
      receiverId: new Types.ObjectId(receiverId),
    };
    if (options?.unreadOnly) {
      filter.isRead = false;
    }

    const list = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async update(
    id: string,
    dto: UpdateNotificationDto,
  ): Promise<Record<string, unknown>> {
    const doc = await this.notificationModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy notification');
    }

    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.content !== undefined) doc.content = dto.content;
    if (dto.isRead !== undefined) doc.isRead = dto.isRead;
    if (dto.data !== undefined) {
      this.mergeData(doc.data, dto.data);
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  async markRead(id: string): Promise<Record<string, unknown>> {
    return this.update(id, { isRead: true });
  }

  async markAllReadForReceiver(receiverId: string): Promise<{ modified: number }> {
    if (!Types.ObjectId.isValid(receiverId)) {
      return { modified: 0 };
    }
    const res = await this.notificationModel.updateMany(
      { receiverId: new Types.ObjectId(receiverId), isRead: false },
      { $set: { isRead: true } },
    );
    return { modified: res.modifiedCount };
  }

  async remove(id: string): Promise<void> {
    const res = await this.notificationModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy notification');
    }
  }

  private mapData(dto?: NotificationDataDto): NotificationData {
    return {
      senderId: dto?.senderId ? new Types.ObjectId(dto.senderId) : null,
      conversationId: dto?.conversationId
        ? new Types.ObjectId(dto.conversationId)
        : null,
      messageId: dto?.messageId ? new Types.ObjectId(dto.messageId) : null,
    };
  }

  private mergeData(target: NotificationData, dto: NotificationDataDto): void {
    if (dto.senderId !== undefined) {
      target.senderId = dto.senderId
        ? new Types.ObjectId(dto.senderId)
        : null;
    }
    if (dto.conversationId !== undefined) {
      target.conversationId = dto.conversationId
        ? new Types.ObjectId(dto.conversationId)
        : null;
    }
    if (dto.messageId !== undefined) {
      target.messageId = dto.messageId
        ? new Types.ObjectId(dto.messageId)
        : null;
    }
  }
}

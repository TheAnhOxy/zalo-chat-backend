import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageDocument,
  MessageMetadata,
  MessageStatus,
  ReactionType,
} from './schemas/message.schema';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessageMetadataDto } from './dto/message-metadata.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  async create(dto: CreateMessageDto): Promise<Record<string, unknown>> {
    const doc = new this.messageModel({
      conversationId: new Types.ObjectId(dto.conversationId),
      senderId: new Types.ObjectId(dto.senderId),
      type: dto.type,
      content: dto.content ?? '',
      metadata: this.buildMetadata(dto.metadata),
      replyTo: dto.replyTo ? new Types.ObjectId(dto.replyTo) : null,
      status: dto.status ?? MessageStatus.SENDING,
      isRecalled: dto.isRecalled ?? false,
      deletedBy: (dto.deletedBy ?? []).map((id) => new Types.ObjectId(id)),
      reactions: (dto.reactions ?? []).map((r) => ({
        userId: new Types.ObjectId(r.userId),
        type: r.type,
      })),
      seenBy: (dto.seenBy ?? []).map((s) => ({
        userId: new Types.ObjectId(s.userId),
        seenAt: s.seenAt ? new Date(s.seenAt) : new Date(),
      })),
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy message');
    }
    const row = await this.messageModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy message');
    }
    return row as Record<string, unknown>;
  }

  async findByConversation(
    conversationId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      return [];
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async update(
    id: string,
    dto: UpdateMessageDto,
  ): Promise<Record<string, unknown>> {
    const doc = await this.messageModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy message');
    }

    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.content !== undefined) doc.content = dto.content;
    if (dto.metadata !== undefined) {
      this.mergeMetadata(doc.metadata, dto.metadata);
    }
    if (dto.replyTo !== undefined) {
      doc.replyTo = dto.replyTo
        ? new Types.ObjectId(dto.replyTo)
        : null;
    }
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.isRecalled !== undefined) doc.isRecalled = dto.isRecalled;
    if (dto.deletedBy !== undefined) {
      doc.deletedBy = dto.deletedBy.map((x) => new Types.ObjectId(x));
    }
    if (dto.reactions !== undefined) {
      doc.reactions = dto.reactions.map((r) => ({
        userId: new Types.ObjectId(r.userId),
        type: r.type,
      })) as Message['reactions'];
    }
    if (dto.seenBy !== undefined) {
      doc.seenBy = dto.seenBy.map((s) => ({
        userId: new Types.ObjectId(s.userId),
        seenAt: s.seenAt ? new Date(s.seenAt) : new Date(),
      })) as Message['seenBy'];
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.messageModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy message');
    }
  }

  /** Thêm user vào deletedBy (soft delete theo user) */
  async addDeletedBy(messageId: string, userId: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(messageId) || !Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Không tìm thấy message');
    }
    const doc = await this.messageModel.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedBy: new Types.ObjectId(userId) } },
      { new: true },
    );
    if (!doc) {
      throw new NotFoundException('Không tìm thấy message');
    }
    return toPlainDoc(doc);
  }

  /** Thêm hoặc cập nhật reaction của một user (một reaction / user) */
  async upsertReaction(
    messageId: string,
    userId: string,
    type: ReactionType,
  ): Promise<Record<string, unknown>> {
    await this.findById(messageId);
    const uid = new Types.ObjectId(userId);

    await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId) },
      { $pull: { reactions: { userId: uid } } },
    );

    const doc = await this.messageModel.findByIdAndUpdate(
      messageId,
      {
        $push: {
          reactions: { userId: uid, type },
        },
      },
      { new: true },
    );
    if (!doc) {
      throw new NotFoundException('Không tìm thấy message');
    }
    return toPlainDoc(doc);
  }

  /** Ghi nhận seen cho user */
  async addSeenBy(
    messageId: string,
    userId: string,
    seenAt?: Date,
  ): Promise<Record<string, unknown>> {
    await this.findById(messageId);
    const uid = new Types.ObjectId(userId);
    const at = seenAt ?? new Date();

    await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId) },
      { $pull: { seenBy: { userId: uid } } },
    );

    const doc = await this.messageModel.findByIdAndUpdate(
      messageId,
      { $push: { seenBy: { userId: uid, seenAt: at } } },
      { new: true },
    );
    if (!doc) {
      throw new NotFoundException('Không tìm thấy message');
    }
    return toPlainDoc(doc);
  }

  private buildMetadata(dto?: MessageMetadataDto): MessageMetadata {
    return {
      fileName: dto?.fileName ?? '',
      fileSize: dto?.fileSize ?? null,
      thumbnail: dto?.thumbnail ?? '',
      lat: dto?.lat ?? null,
      lng: dto?.lng ?? null,
      duration: dto?.duration ?? null,
    };
  }

  private mergeMetadata(
    target: MessageMetadata,
    dto: MessageMetadataDto,
  ): void {
    if (dto.fileName !== undefined) target.fileName = dto.fileName;
    if (dto.fileSize !== undefined) target.fileSize = dto.fileSize;
    if (dto.thumbnail !== undefined) target.thumbnail = dto.thumbnail;
    if (dto.lat !== undefined) target.lat = dto.lat;
    if (dto.lng !== undefined) target.lng = dto.lng;
    if (dto.duration !== undefined) target.duration = dto.duration;
  }
}

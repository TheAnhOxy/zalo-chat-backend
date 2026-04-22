import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageDocument,
  MessageMetadata,
  MessageStatus,
  ReactionType,
  MessageType,
} from './schemas/message.schema';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessageMetadataDto } from './dto/message-metadata.dto';
import { toPlainDoc } from '../common/mongo-plain';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private conversationsService: ConversationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  // ================= CREATE =================
  async create(dto: CreateMessageDto): Promise<Record<string, unknown>> {
    this.logger.debug('DTO nhận được:', JSON.stringify(dto));
    this.logger.debug(`TYPE RECEIVED: "${dto.type}"`);

    const cleanType = (dto.type as string)?.trim();
    
    const messageData = {
      conversationId: new Types.ObjectId(dto.conversationId),
      senderId: new Types.ObjectId(dto.senderId),
      messageType: cleanType as MessageType, // Đồng bộ với Schema mới
      content: dto.content ?? '',
      metadata: this.buildMetadata(dto.metadata),
      replyTo: dto.replyTo ? new Types.ObjectId(dto.replyTo) : null,
      status: dto.status ?? MessageStatus.SENDING,
      isRecalled: dto.isRecalled ?? false,
      deletedBy: (dto.deletedBy ?? []).map((id) => new Types.ObjectId(id)),
      reactions: (dto.reactions ?? []).map((r) => ({
        userId: new Types.ObjectId(r.userId),
        reactionType: r.type, 
      })),
      seenBy: (dto.seenBy ?? []).map((s) => ({
        userId: new Types.ObjectId(s.userId),
        seenAt: s.seenAt ? new Date(s.seenAt) : new Date(),
      })),
    };

    try {
      const doc = new this.messageModel(messageData);
      const saved = await doc.save();
      const plainMsg = toPlainDoc(saved);

      this.logger.debug('AFTER SAVE ✅');

      // ==================== CẬP NHẬT lastMessage ====================
      try {
        await this.conversationsService.updateLastMessage(dto.conversationId, {
          messageId: plainMsg._id?.toString() || saved._id.toString(),
          content: (plainMsg.content as string) ?? '',
          senderId: dto.senderId,
          createdAt: new Date().toISOString(),
        });
        this.logger.debug(
          `Đã cập nhật lastMessage cho conversation ${dto.conversationId}`,
        );
      } catch (updateError: any) {
        this.logger.warn(
          `Không cập nhật được lastMessage: ${updateError.message}`,
        );
        // Không throw để tránh ảnh hưởng việc gửi tin nhắn
      }

      return plainMsg;
    } catch (error) {
      throw error;
    }
  }

  // ================= FIND =================
  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ID tin nhắn không hợp lệ');
    }
    const row = await this.messageModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy tin nhắn');
    }
    return row as Record<string, unknown>;
  }

  async findByConversation(
    conversationId: string,
    userId: string,
    options?: { limit?: number; skip?: number; pinnedOnly?: boolean },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(conversationId)) return [];

    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const filter: any = {
      conversationId: new Types.ObjectId(conversationId),
    };

    if (options?.pinnedOnly) {
      filter.isPinned = true;
    }

    // Lọc bỏ tin nhắn mà userId này đã nhấn "Xóa phía tôi"
    if (userId && Types.ObjectId.isValid(userId)) {
      filter.deletedBy = { $ne: new Types.ObjectId(userId) };
    }

    const list = await this.messageModel
      .find(filter)
      .sort(options?.pinnedOnly ? { pinnedAt: -1, createdAt: -1 } : { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  // ================= UPDATE =================
  async update(id: string, dto: UpdateMessageDto): Promise<Record<string, unknown>> {
    const doc = await this.messageModel.findById(id);
    if (!doc) throw new NotFoundException('Không tìm thấy tin nhắn');

    if (dto.type !== undefined) (doc as any).messageType = dto.type;
    if (dto.content !== undefined) doc.content = dto.content;
    if (dto.metadata !== undefined) this.mergeMetadata(doc.metadata, dto.metadata);
    if (dto.replyTo !== undefined) {
      doc.replyTo = dto.replyTo ? new Types.ObjectId(dto.replyTo) : null;
    }
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.isRecalled !== undefined) doc.isRecalled = dto.isRecalled;
    if (dto.isPinned !== undefined) {
      doc.isPinned = dto.isPinned;
      doc.pinnedAt = dto.isPinned ? new Date() : null;
    }
    if (dto.deletedBy !== undefined) {
      doc.deletedBy = dto.deletedBy.map((x) => new Types.ObjectId(x));
    }
    if (dto.reactions !== undefined) {
      doc.reactions = dto.reactions.map((r) => ({
        userId: new Types.ObjectId(r.userId),
        reactionType: r.type,
      })) as any;
    }
    if (dto.seenBy !== undefined) {
      doc.seenBy = dto.seenBy.map((s) => ({
        userId: new Types.ObjectId(s.userId),
        seenAt: s.seenAt ? new Date(s.seenAt) : new Date(),
      })) as any;
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  // ================= ACTIONS =================
  async remove(id: string): Promise<void> {
    const res = await this.messageModel.findByIdAndDelete(id).exec();
    if (!res) throw new NotFoundException('Không tìm thấy tin nhắn');
  }

  async addDeletedBy(messageId: string, userId: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(messageId) || !Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('ID không hợp lệ');
    }
    const doc = await this.messageModel.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedBy: new Types.ObjectId(userId) } },
      { new: true },
    );
    if (!doc) throw new NotFoundException('Không tìm thấy tin nhắn');
    return toPlainDoc(doc);
  }

  async deleteConversationForMe(
    conversationId: string,
    userId: string,
  ): Promise<{ success: boolean; modifiedCount: number }> {
    if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('ID không hợp lệ');
    }

    const cid = new Types.ObjectId(conversationId);
    const uid = new Types.ObjectId(userId);

    const res = await this.messageModel.updateMany(
      { conversationId: cid, deletedBy: { $ne: uid } },
      { $addToSet: { deletedBy: uid } },
    );

    // Realtime cho cùng user trên nhiều thiết bị/tab
    this.realtimeService.emitToRoom(userId, 'conversation_history_cleared', {
      conversationId,
      updatedAt: new Date().toISOString(),
    });

    return {
      success: true,
      modifiedCount: (res as any).modifiedCount ?? 0,
    };
  }

  async upsertReaction(messageId: string, userId: string, type: ReactionType): Promise<Record<string, unknown>> {
    const uid = new Types.ObjectId(userId);
    const mid = new Types.ObjectId(messageId);

    await this.messageModel.updateOne({ _id: mid }, { $pull: { reactions: { userId: uid } } });

    const doc = await this.messageModel.findByIdAndUpdate(
      mid,
      { $push: { reactions: { userId: uid, reactionType: type } } },
      { new: true },
    );
    if (!doc) throw new NotFoundException('Không tìm thấy tin nhắn');
    return toPlainDoc(doc);
  }

  async addSeenBy(messageId: string, userId: string, seenAt?: Date): Promise<Record<string, unknown>> {
    const uid = new Types.ObjectId(userId);
    const mid = new Types.ObjectId(messageId);
    const at = seenAt ?? new Date();

    await this.messageModel.updateOne({ _id: mid }, { $pull: { seenBy: { userId: uid } } });

    const doc = await this.messageModel.findByIdAndUpdate(
      mid,
      { $push: { seenBy: { userId: uid, seenAt: at } } },
      { new: true },
    );
    if (!doc) throw new NotFoundException('Không tìm thấy tin nhắn');
    return toPlainDoc(doc);
  }

  // ================= HELPERS =================
  private buildMetadata(dto?: MessageMetadataDto): MessageMetadata {
    return {
      fileName: dto?.fileName ?? '',
      fileSize: dto?.fileSize ?? null,
      thumbnail: dto?.thumbnailUrl ?? dto?.thumbnail ?? '',
      lat: dto?.lat ?? null,
      lng: dto?.lng ?? null,
      duration: dto?.duration ?? null,
    };
  }

  private mergeMetadata(target: MessageMetadata, dto: MessageMetadataDto): void {
    if (dto.fileName !== undefined) target.fileName = dto.fileName;
    if (dto.fileSize !== undefined) target.fileSize = dto.fileSize;
    if (dto.thumbnailUrl !== undefined) target.thumbnail = dto.thumbnailUrl;
    if (dto.thumbnail !== undefined) target.thumbnail = dto.thumbnail;
    if (dto.lat !== undefined) target.lat = dto.lat;
    if (dto.lng !== undefined) target.lng = dto.lng;
    if (dto.duration !== undefined) target.duration = dto.duration;
  }
  async findUnseenMessages(
    conversationId: string,
    userId: string,
  ): Promise<any[]> {
    if (
      !Types.ObjectId.isValid(conversationId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      return [];
    }
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);

    return await this.messageModel
      .find({
        conversationId: cid,
        senderId: { $ne: uid }, // Không phải tin của mình
        isRecalled: false,
        'seenBy.userId': { $ne: uid }, // Chưa có trong seenBy
      })
      .select('_id')
      .lean()
      .exec();
  }

  async bulkMarkSeen(
    messageIds: string[],
    userId: string,
    seenAt: Date,
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const uid = new Types.ObjectId(userId);

    await this.messageModel.updateMany(
      {
        _id: { $in: messageIds.map((id) => new Types.ObjectId(id)) },
        'seenBy.userId': { $ne: uid },
      },
      {
        $push: { seenBy: { userId: uid, seenAt } },
        $set: { status: 'SEEN' },
      },
    );
  }
}

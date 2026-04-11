import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
  ConversationMemberRole,
  LastMessage,
} from './schemas/conversation.schema';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ConversationMemberDto } from './dto/conversation-member.dto';
import { LastMessageDto } from './dto/last-message.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
  ) {}

  async create(dto: CreateConversationDto): Promise<Record<string, unknown>> {
    const doc = new this.conversationModel({
      type: dto.type,
      name: dto.name ?? '',
      avatar: dto.avatar ?? '',
      members: this.mapMembers(dto.members),
      lastMessage: dto.lastMessage
        ? this.mapLastMessage(dto.lastMessage)
        : null,
      groupSettings: dto.groupSettings
        ? {
            allowInviteLink: dto.groupSettings.allowInviteLink ?? true,
            joinQrCode: dto.groupSettings.joinQrCode ?? '',
            isLockChat: dto.groupSettings.isLockChat ?? false,
          }
        : undefined,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.conversationModel.find().lean().exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
    const row = await this.conversationModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
    return row as Record<string, unknown>;
  }

  async findByMemberUserId(
    userId: string,
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const list = await this.conversationModel
      .find({
        'members.userId': new Types.ObjectId(userId),
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  async update(
    id: string,
    dto: UpdateConversationDto,
  ): Promise<Record<string, unknown>> {
    const doc = await this.conversationModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy conversation');
    }

    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.name !== undefined) doc.name = dto.name;
    if (dto.avatar !== undefined) doc.avatar = dto.avatar;
    if (dto.members !== undefined) {
      doc.members = this.mapMembers(dto.members) as Conversation['members'];
    }
    if (dto.lastMessage === null) {
      doc.lastMessage = null;
    } else if (dto.lastMessage !== undefined) {
      doc.lastMessage = this.mapLastMessage(
        dto.lastMessage,
      ) as Conversation['lastMessage'];
    }
    if (dto.groupSettings !== undefined) {
      Object.assign(doc.groupSettings, dto.groupSettings);
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.conversationModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
  }

  private mapMembers(members: ConversationMemberDto[]) {
    return members.map((m) => ({
      userId: new Types.ObjectId(m.userId),
      role: m.role ?? ConversationMemberRole.MEMBER,
      nickname: m.nickname ?? '',
      joinedAt: m.joinedAt ? new Date(m.joinedAt) : new Date(),
      isMuted: m.isMuted ?? false,
      isPinned: m.isPinned ?? false,
      isHidden: m.isHidden ?? false,
      hiddenPin: m.hiddenPin ?? '',
    }));
  }

  private mapLastMessage(dto: LastMessageDto): LastMessage {
    return {
      messageId: dto.messageId
        ? new Types.ObjectId(dto.messageId)
        : null,
      content: dto.content,
      senderId: new Types.ObjectId(dto.senderId),
      createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
    };
  }
}

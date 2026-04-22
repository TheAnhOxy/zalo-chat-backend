import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from '../messages/schemas/message.schema';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  Conversation,
  ConversationDocument,
  ConversationMember,
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
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    private readonly configService: ConfigService,
  ) {}

  private ensureGroupSettings(doc: ConversationDocument): void {
    if (doc.groupSettings) return;
    doc.groupSettings = {
      allowInviteLink: true,
      joinQrCode: '',
      isLockChat: false,
      chatBackgroundType: 'PRESET',
      chatBackgroundIndex: 0,
      chatBackgroundCustomBase64: '',
    } as unknown as Conversation['groupSettings'];
  }

  private randomCode(length = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  private inviteLinkFromCode(code: string): string {
    // Có thể thay bằng deep-link sau. Tạm dùng URL backend để dễ test trên web.
    const base =
      this.configService.get<string>('PUBLIC_APP_URL') ??
      this.configService.get<string>('PUBLIC_BASE_URL') ??
      `http://localhost:${process.env.PORT || 8081}`;
    return `${base}/conversations/join?code=${encodeURIComponent(code)}`;
  }

  async getOrCreateInviteLink(
    conversationId: string,
  ): Promise<{ enabled: boolean; code: string; link: string }> {
    const doc = await this.conversationModel.findById(conversationId);
    if (!doc) throw new NotFoundException('Không tìm thấy conversation');

    this.ensureGroupSettings(doc);

    if (!doc.groupSettings.joinQrCode) {
      doc.groupSettings.joinQrCode = this.randomCode(12);
      await doc.save();
    }

    const code = doc.groupSettings.joinQrCode;
    return {
      enabled: doc.groupSettings.allowInviteLink !== false,
      code,
      link: this.inviteLinkFromCode(code),
    };
  }

  async regenerateInviteLink(
    conversationId: string,
  ): Promise<{ enabled: boolean; code: string; link: string }> {
    const doc = await this.conversationModel.findById(conversationId);
    if (!doc) throw new NotFoundException('Không tìm thấy conversation');

    this.ensureGroupSettings(doc);

    doc.groupSettings.joinQrCode = this.randomCode(12);
    await doc.save();

    const code = doc.groupSettings.joinQrCode;
    return {
      enabled: doc.groupSettings.allowInviteLink !== false,
      code,
      link: this.inviteLinkFromCode(code),
    };
  }

  async joinByInviteLink(
    code: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User ID không hợp lệ');
    }

    const conv = await this.conversationModel.findOne({
      type: 'GROUP',
      'groupSettings.joinQrCode': code,
      'groupSettings.allowInviteLink': { $ne: false },
    });
    if (!conv) {
      throw new NotFoundException('Link nhóm không hợp lệ hoặc đã tắt');
    }

    const uid = new Types.ObjectId(userId);
    const exists = conv.members.some((m) => String(m.userId) === String(uid));
    if (!exists) {
      const member: ConversationMember = {
        userId: uid,
        role: ConversationMemberRole.MEMBER,
        nickname: '',
        joinedAt: new Date(),
        isMuted: false,
        isPinned: false,
        isHidden: false,
        hiddenPin: '',
      };
      conv.members.push(member);
      await conv.save();
    }

    return toPlainDoc(conv);
  }

  /** Upload ảnh nhóm qua backend → S3, trả về URL công khai. */
  async uploadGroupAvatar(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<{ fileUrl: string }> {
    const region = this.configService.get<string>('S3_REGION');
    const bucket = this.configService.get<string>('S3_BUCKET_NAME');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'Missing S3 configuration: S3_REGION, S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY',
      );
    }

    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/svg+xml': 'svg',
      'image/x-icon': 'ico',
    };
    const ext = extMap[file.mimetype] ?? 'jpg';
    const objectKey = `group-avatars/${Date.now()}.${ext}`;
    const s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(command);

    const fileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
    return { fileUrl };
  }

  async create(dto: CreateConversationDto): Promise<Record<string, unknown>> {
    const doc = new this.conversationModel({
      type: dto.type,
      name: dto.name ?? '',
      avatar: dto.avatar ?? '',
      description: dto.description ?? '',
      members: this.mapMembers(dto.members),
      lastMessage: dto.lastMessage
        ? this.mapLastMessage(dto.lastMessage)
        : null,
      groupSettings: dto.groupSettings
        ? {
            allowInviteLink: dto.groupSettings.allowInviteLink ?? true,
            joinQrCode: dto.groupSettings.joinQrCode ?? '',
            isLockChat: dto.groupSettings.isLockChat ?? false,
            chatBackgroundType:
              dto.groupSettings.chatBackgroundType ?? 'PRESET',
            chatBackgroundIndex: dto.groupSettings.chatBackgroundIndex ?? 0,
            chatBackgroundCustomBase64:
              dto.groupSettings.chatBackgroundCustomBase64 ?? '',
          }
        : undefined,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.conversationModel
      .find()
      .populate('pinnedMessageIds')
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
    const row = await this.conversationModel
      .findById(id)
      .populate('pinnedMessageIds')
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
    return row as Record<string, unknown>;
  }

  async findByMemberUserId(userId: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) return [];

    const userObjId = new Types.ObjectId(userId);

    const conversations = await this.conversationModel.aggregate([
      {
        $match: { 'members.userId': userObjId },
      },
      {
        $lookup: {
          from: 'messages',
          let: { pinnedIds: '$pinnedMessageIds' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', { $ifNull: ['$$pinnedIds', []] }] },
              },
            },
            { $sort: { pinnedAt: -1, createdAt: -1 } },
          ],
          as: 'pinnedMessageIds',
        },
      },
      {
        $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'conversationId',
          as: 'allMessages',
        },
      },
      {
        $addFields: {
          unreadCount: {
            $size: {
              $filter: {
                input: '$allMessages',
                as: 'msg',
                cond: {
                  $and: [
                    { $ne: ['$$msg.senderId', userObjId] }, // Không phải tin của mình
                    { $eq: ['$$msg.isRecalled', false] },
                    {
                      $not: {
                        $in: [
                          userObjId,
                          { $ifNull: ['$$msg.seenBy.userId', []] },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $project: { allMessages: 0 } }, // bỏ bớt dữ liệu thừa
    ]);

    return conversations as Record<string, unknown>[];
  }

  async findMemberUserIdsByUserId(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];

    const conversations = await this.conversationModel
      .find({ 'members.userId': new Types.ObjectId(userId) })
      .select('members.userId')
      .lean()
      .exec();

    const memberIds = new Set<string>();
    for (const conversation of conversations) {
      for (const member of conversation.members ?? []) {
        const memberId = String(member.userId);
        if (memberId !== userId) {
          memberIds.add(memberId);
        }
      }
    }

    return Array.from(memberIds);
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
    if (dto.description !== undefined) doc.description = dto.description;
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

  async updateLastMessage(
    conversationId: string,
    lastMsgDto: LastMessageDto,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation ID không hợp lệ');
    }

    const updateData = {
      lastMessage: this.mapLastMessage(lastMsgDto),
      updatedAt: new Date(), // Quan trọng để sort danh sách chat
    };

    const result = await this.conversationModel.findByIdAndUpdate(
      conversationId,
      { $set: updateData },
      { new: true },
    );

    if (!result) {
      throw new NotFoundException('lỗi update last message');
    }
  }

  async remove(id: string): Promise<void> {
    const res = await this.conversationModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy conversation');
    }
  }

  async addPinnedMessageId(
    conversationId: string,
    messageId: string,
  ): Promise<{ wasAdded: boolean }> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation ID không hợp lệ');
    }
    if (!Types.ObjectId.isValid(messageId)) {
      throw new NotFoundException('Message ID không hợp lệ');
    }

    const cid = new Types.ObjectId(conversationId);
    const mid = new Types.ObjectId(messageId);

    const messageExists = await this.messageModel.exists({
      _id: mid,
      conversationId: cid,
    });
    if (!messageExists) {
      throw new NotFoundException('Tin nhắn không thuộc hội thoại này');
    }

    const result = await this.conversationModel.updateOne(
      { _id: cid },
      { $addToSet: { pinnedMessageIds: mid } },
    );

    if (!result.matchedCount) {
      throw new NotFoundException('Không tìm thấy conversation');
    }

    return { wasAdded: result.modifiedCount > 0 };
  }

  async removePinnedMessageId(
    conversationId: string,
    messageId: string,
  ): Promise<{ wasRemoved: boolean }> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation ID không hợp lệ');
    }
    if (!Types.ObjectId.isValid(messageId)) {
      throw new NotFoundException('Message ID không hợp lệ');
    }

    const cid = new Types.ObjectId(conversationId);
    const mid = new Types.ObjectId(messageId);

    const result = await this.conversationModel.updateOne(
      { _id: cid },
      { $pull: { pinnedMessageIds: mid } },
    );

    if (!result.matchedCount) {
      throw new NotFoundException('Không tìm thấy conversation');
    }

    return { wasRemoved: result.modifiedCount > 0 };
  }

  async findPinnedMessages(conversationId: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new NotFoundException('Conversation ID không hợp lệ');
    }

    const conversation = await this.conversationModel
      .findById(conversationId)
      .populate({
        path: 'pinnedMessageIds',
        options: { sort: { pinnedAt: -1, createdAt: -1 } },
        populate: [{ path: 'senderId' }, { path: 'replyTo' }],
      })
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy conversation');
    }

    const pinnedMessages = conversation.pinnedMessageIds as unknown as Record<
      string,
      unknown
    >[];
    return (pinnedMessages ?? []).filter(Boolean);
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
      messageId: dto.messageId ? new Types.ObjectId(dto.messageId) : null,
      content: dto.content,
      senderId: new Types.ObjectId(dto.senderId),
      createdAt: dto.createdAt ? new Date(dto.createdAt) : new Date(),
    };
  }
}

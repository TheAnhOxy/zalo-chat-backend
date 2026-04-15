import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  S3Client,
  PutObjectCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
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
export class ConversationsService implements OnModuleInit {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureS3BucketCors();
  }

  /** Cấu hình CORS cho S3 bucket để Flutter Web (Chrome) có thể load ảnh. */
  private async ensureS3BucketCors(): Promise<void> {
    const region = this.configService.get<string>('S3_REGION');
    const bucket = this.configService.get<string>('S3_BUCKET_NAME');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn('S3 config chưa đủ, bỏ qua setup CORS');
      return;
    }

    try {
      const s3Client = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });

      await s3Client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['*'],
                AllowedMethods: ['GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );

      this.logger.log(`S3 CORS đã được cấu hình cho bucket: ${bucket}`);
    } catch (err) {
      this.logger.error('Không thể set S3 CORS:', err);
    }
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

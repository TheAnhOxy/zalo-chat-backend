import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Groq from 'groq-sdk';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { FriendshipsService } from '../friendships/friendships.service';
import { UsersService } from '../users/users.service';
import {
  Friendship,
  FriendshipDocument,
  FriendshipStatus,
} from '../friendships/schemas/friendship.schema';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';
import { Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
  ConversationType,
} from '../conversations/schemas/conversation.schema';
import { Message, MessageDocument } from '../messages/schemas/message.schema';
import {
  ChatbotConversation,
  ChatbotConversationDocument,
} from './schemas/chatbot-conversation.schema';
import {
  ChatbotMessage,
  ChatbotMessageDocument,
} from './schemas/chatbot-message.schema';
import { promptStore } from './prompt_store';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly groq: Groq | null;
  private readonly hasGroqKey: boolean;
  private readonly s3: S3Client;

  constructor(
    private readonly friendshipsService: FriendshipsService,
    private readonly usersService: UsersService,
    @InjectModel(Friendship.name)
    private readonly friendshipModel: Model<FriendshipDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(ChatbotConversation.name)
    private readonly chatbotConversationModel: Model<ChatbotConversationDocument>,
    @InjectModel(ChatbotMessage.name)
    private readonly chatbotMessageModel: Model<ChatbotMessageDocument>,
  ) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      this.logger.warn('GROQ_API_KEY chưa được cấu hình trong .env');
    }
    this.hasGroqKey = Boolean(groqKey && groqKey.trim().length > 0);
    this.groq = this.hasGroqKey ? new Groq({ apiKey: groqKey }) : null;

    this.s3 = new S3Client({
      region: process.env.S3_REGION || 'ap-southeast-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async listConversations(userId: string) {
    const uid = new Types.ObjectId(userId);
    const items = await this.chatbotConversationModel
      .find({ userId: uid })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean()
      .exec();
    return {
      conversations: items.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        lastMessageAt: c.lastMessageAt,
        createdAt: null,
        updatedAt: null,
      })),
    };
  }

  async createConversation(userId: string, title?: string) {
    const uid = new Types.ObjectId(userId);
    const conv = await this.chatbotConversationModel.create({
      userId: uid,
      title: title?.trim() || 'Cuộc trò chuyện mới',
      lastMessageAt: new Date(),
    });
    return { id: conv._id.toString(), title: conv.title };
  }

  async renameConversation(
    userId: string,
    conversationId: string,
    title: string,
  ) {
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);
    const nextTitle = title.trim();
    await this.chatbotConversationModel.updateOne(
      { _id: cid, userId: uid },
      { $set: { title: nextTitle } },
    );
    return { success: true, id: conversationId, title: nextTitle };
  }

  async deleteConversation(userId: string, conversationId: string) {
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);
    await this.chatbotMessageModel.deleteMany({
      userId: uid,
      conversationId: cid,
    });
    await this.chatbotConversationModel.deleteOne({ _id: cid, userId: uid });
    return { success: true };
  }

  async clearConversationMessages(userId: string, conversationId: string) {
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);
    await this.chatbotMessageModel.deleteMany({
      userId: uid,
      conversationId: cid,
    });
    await this.chatbotConversationModel.updateOne(
      { _id: cid, userId: uid },
      { $set: { lastMessageAt: new Date() } },
    );
    return { success: true };
  }

  async getConversationMessages(userId: string, conversationId: string) {
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);
    const items = await this.chatbotMessageModel
      .find({ userId: uid, conversationId: cid })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    return {
      messages: items.map((m) => ({
        id: m._id.toString(),
        role: m.role,
        content: m.content,
        createdAt: null,
        toolsUsed: m.toolsUsed ?? [],
        attachments: (m.attachments ?? []).map((a) => ({
          name: a.name,
          url: a.url,
          mimeType: a.mimeType,
        })),
      })),
    };
  }

  async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string,
  ) {
    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);
    const mid = new Types.ObjectId(messageId);

    await this.chatbotMessageModel.deleteOne({
      _id: mid,
      userId: uid,
      conversationId: cid,
    });

    return { success: true };
  }

  // ======================== TOOL DEFINITIONS ========================

  private readonly toolDeclarations: any[] = [
    {
      name: 'getFriendCount',
      description: 'Lấy tổng số bạn bè (đã ACCEPTED) của user',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
        },
        required: [],
      },
    },
    {
      name: 'getFriendList',
      description:
        'Lấy danh sách bạn bè của user (đã ACCEPTED), kèm tên và avatar',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
          limit: {
            type: 'NUMBER',
            description: 'Số lượng tối đa, mặc định 10',
          },
        },
        required: [],
      },
    },
    {
      name: 'getRecentFriends',
      description: 'Lấy danh sách bạn bè mới kết bạn gần đây nhất',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
          limit: {
            type: 'NUMBER',
            description: 'Số lượng kết quả, mặc định 5',
          },
        },
        required: [],
      },
    },
    {
      name: 'getPendingFriendRequests',
      description:
        'Lấy danh sách lời mời kết bạn đang chờ xác nhận (PENDING) gửi đến user',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
        },
        required: [],
      },
    },
    {
      name: 'getUserInfo',
      description:
        'Lấy thông tin chi tiết của user (tên, avatar, email, trạng thái online)',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
        },
        required: [],
      },
    },
    {
      name: 'searchUserByName',
      description: 'Tìm kiếm user theo tên (fullName) trong danh sách bạn bè',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Tên cần tìm kiếm' },
          userId: {
            type: 'STRING',
            description: 'Alias của currentUserId (MongoDB ObjectId của user hiện tại)',
          },
          currentUserId: {
            type: 'STRING',
            description: 'MongoDB ObjectId của user hiện tại',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'getChatMessages',
      description:
        'Lấy N tin nhắn gần nhất của 1 cuộc trò chuyện chat thật (nhóm/1-1) mà user đang là thành viên',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
          conversationId: {
            type: 'STRING',
            description:
              'MongoDB ObjectId của conversation. NẾU KHÔNG BIẾT ID, hãy truyền TÊN NGƯỜI/NHÓM (vd: "Wind", "Team Văn Hóa"). TUYỆT ĐỐI KHÔNG tự bịa chuỗi 24 ký tự hex.',
          },
          limit: {
            anyOf: [{ type: 'NUMBER' }, { type: 'STRING' }],
            description: 'Số lượng tin nhắn (1-200), mặc định 60',
          },
        },
        required: ['conversationId'],
      },
    },
    {
      name: 'searchChatMessages',
      description:
        'Tìm tin nhắn theo từ khoá trong 1 cuộc trò chuyện chat thật (chỉ trong phạm vi user là thành viên)',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          currentUserId: {
            type: 'STRING',
            description: 'Alias của userId (MongoDB ObjectId của user hiện tại)',
          },
          conversationId: {
            type: 'STRING',
            description:
              'MongoDB ObjectId của conversation. NẾU KHÔNG BIẾT ID, hãy truyền TÊN NGƯỜI/NHÓM (vd: "Wind", "Team Văn Hóa"). TUYỆT ĐỐI KHÔNG tự bịa chuỗi 24 ký tự hex.',
          },
          query: { type: 'STRING', description: 'Từ khoá cần tìm' },
          limit: {
            anyOf: [{ type: 'NUMBER' }, { type: 'STRING' }],
            description: 'Số lượng kết quả (1-100), mặc định 30',
          },
        },
        required: ['conversationId', 'query'],
      },
    },
  ];

  // ======================== TOOL EXECUTION ========================

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: {
      currentUserId?: string;
      lockedConversationId?: string;
      normalizedUserMessage?: string;
      forceLookupName?: string;
      forceLookupByName?: boolean;
    },
  ): Promise<unknown> {
    this.logger.debug(`Executing tool: ${toolName}`, args);

    const currentUserId = this.asSafeString(context?.currentUserId).trim();
    const lockedConversationId = this.asSafeString(
      context?.lockedConversationId,
    ).trim();
    const normalizedUserMessage = this.asSafeString(
      context?.normalizedUserMessage,
    ).trim();
    const forceLookupName = this.asSafeString(context?.forceLookupName).trim();
    const forceLookupByName = context?.forceLookupByName === true;

    const resolveUserId = (raw: unknown): string => {
      if (currentUserId) return currentUserId;
      return this.asSafeString(raw).trim();
    };

    const resolveConversationId = (raw: unknown): string => {
      if (lockedConversationId) {
        const requested = this.asSafeString(raw).trim();
        if (requested && requested !== lockedConversationId) {
          this.logger.warn(
            `Tool requested conversationId=${requested} nhưng đã bị khóa theo request conversationId=${lockedConversationId}`,
          );
        }
        return lockedConversationId;
      }
      return this.asSafeString(raw).trim();
    };

    switch (toolName) {
      case 'getFriendCount': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const acceptedFriends = await this.getAcceptedFriendProfiles(userId);
        return {
          count: acceptedFriends.length,
          message: `User có ${acceptedFriends.length} bạn bè`,
        };
      }

      case 'getFriendList': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const limit = this.parsePositiveInt(args.limit, 10, 1, 200);
        const allFriends = await this.getAcceptedFriendProfiles(userId);
        const friends = allFriends.slice(0, limit);

        return {
          friends,
          total: allFriends.length,
          returned: friends.length,
        };
      }

      case 'getRecentFriends': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const limit = this.parsePositiveInt(args.limit, 5, 1, 100);
        const recentFriends = await this.getRecentAcceptedFriendProfiles(
          userId,
          limit,
        );

        return {
          recentFriends,
          returned: recentFriends.length,
        };
      }

      case 'getPendingFriendRequests': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const friendships = await this.friendshipsService.findByUserId(userId);
        const pending = friendships.filter(
          (f) =>
            f['status'] === FriendshipStatus.PENDING &&
            f['addresseeId']?.toString() === userId,
        );

        const requestDetails = await Promise.all(
          pending.map(async (f) => {
            const requesterId: string = f['requesterId']?.toString() ?? '';
            if (!requesterId) return { requesterId: '', fullName: 'Unknown' };
            try {
              const user = await this.usersService.findById(requesterId);
              return {
                requesterId,
                fullName: user['fullName'],
                avatar: user['avatar'],
                sentAt: f['createdAt'],
              };
            } catch {
              return { requesterId, fullName: 'Unknown' };
            }
          }),
        );

        return {
          pendingRequests: requestDetails,
          count: requestDetails.length,
        };
      }

      case 'getUserInfo': {
        const rawUserId = this.asSafeString(
          args.userId ?? args.currentUserId,
        ).trim();
        let userId = rawUserId;

        // Trường hợp model chưa có userId mục tiêu cho câu hỏi thuộc nhóm thông tin cá nhân
        // (phone/email/avatar/online...), bắt buộc lookup theo tên trước.
        const shouldForceLookupByName =
          forceLookupByName &&
          (userId.length === 0 || !Types.ObjectId.isValid(userId));

        if (shouldForceLookupByName) {
          const lookupName = forceLookupName || userId;
          const matches = await this.searchFriendUsersByName(
            currentUserId,
            lookupName,
          );
          if (matches.length > 0) {
            userId = matches[0].userId;
            this.logger.debug(
              `[db-fallback] getUserInfo thiếu userId, đã resolve qua searchUserByName: '${lookupName}' -> ${userId}`,
            );
          } else if (lookupName) {
            return {
              error: `Không tìm thấy bạn bè tên "${lookupName}"`,
              hint: 'Hãy kiểm tra lại tên hoặc thêm người này vào danh sách bạn bè trước.',
            };
          }
        }

        if (!userId) {
          userId = resolveUserId(args.userId);
        }

        if (!userId || !Types.ObjectId.isValid(userId)) {
          return {
            error: 'userId không hợp lệ để lấy thông tin user',
            inputUserId: userId,
            message: normalizedUserMessage,
          };
        }

        const user = (await this.usersService.findById(
          userId,
        )) as unknown as Record<string, unknown>;
        return {
          userId,
          fullName: user['fullName'],
          email: user['email'],
          phone: user['phone'],
          avatar: user['avatar'],
          bio: user['bio'],
          isOnline: this.getIsOnlineFromUser(user),
          lastSeen: this.getLastSeenFromUser(user),
        };
      }

      case 'searchUserByName': {
        // Tìm theo tên trong danh sách bạn bè của currentUser
        const { name, currentUserId } = args as {
          name: string;
          currentUserId: string;
        };
        const effectiveCurrentUserId = resolveUserId(
          currentUserId ?? args.userId,
        );
        const found = await this.searchFriendUsersByName(
          effectiveCurrentUserId,
          this.asSafeString(name),
        );
        return { results: found, count: found.length };
      }

      case 'getChatMessages': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const conversationId = resolveConversationId(args.conversationId);
        const limitRaw =
          typeof args.limit === 'number'
            ? args.limit
            : typeof args.limit === 'string'
              ? Number(args.limit)
              : undefined;
        // Giảm limit xuống tối đa 60 để tránh lỗi 413 Request Too Large của Groq
        const limit = Math.min(Math.max(limitRaw ?? 40, 1), 60);
        return await this.getChatMessagesForAi({
          userId,
          conversationId,
          limit,
        });
      }

      case 'searchChatMessages': {
        const userId = resolveUserId(args.userId ?? args.currentUserId);
        const conversationId = resolveConversationId(args.conversationId);
        const query = this.asSafeString(args.query).trim();
        const limitRaw =
          typeof args.limit === 'number'
            ? args.limit
            : typeof args.limit === 'string'
              ? Number(args.limit)
              : undefined;
        const limit = Math.min(Math.max(limitRaw ?? 30, 1), 100);
        return await this.searchChatMessagesForAi({
          userId,
          conversationId,
          query,
          limit,
        });
      }

      default:
        return { error: `Tool '${toolName}' không được hỗ trợ` };
    }
  }

  private asSafeString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // Mongoose ObjectId hoặc các object có toString() (vd: _id, senderId)
    if (value instanceof Types.ObjectId) return value.toString();
    if (value && typeof value === 'object') {
      try {
        const s = (value as { toString?: () => string }).toString?.();
        if (typeof s === 'string' && s !== '[object Object]') return s;
      } catch {
        // ignore
      }
    }
    return '';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, unknown>;
  }

  private normalizeForIntent(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[đ]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasAnyPhrase(text: string, phrases: string[]): boolean {
    if (!text) return false;
    return phrases.some((p) => text.includes(p));
  }

  private parsePositiveInt(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.floor(n);
    return Math.min(Math.max(rounded, min), max);
  }

  private getFriendIdFromRelation(
    row: Record<string, unknown>,
    userId: string,
  ): string {
    const requesterId = this.asSafeString(row['requesterId']).trim();
    const addresseeId = this.asSafeString(row['addresseeId']).trim();
    if (!requesterId && !addresseeId) return '';
    if (requesterId === userId) return addresseeId;
    if (addresseeId === userId) return requesterId;
    return requesterId || addresseeId;
  }

  private async getAcceptedFriendProfiles(userId: string): Promise<
    Array<{
      userId: string;
      fullName: string;
      avatar: unknown;
      isOnline: boolean;
    }>
  > {
    const friendIds = await this.friendshipsService.findAcceptedFriendIdsByUserId(
      userId,
    );
    const uniqueIds = Array.from(
      new Set(friendIds.filter((id) => id && id !== userId)),
    );

    const profiles = await Promise.all(
      uniqueIds.map(async (fid) => {
        try {
          const user = (await this.usersService.findById(
            fid,
          )) as unknown as Record<string, unknown>;
          const fullName = this.asSafeString(user['fullName']).trim();
          return {
            userId: fid,
            fullName: fullName || 'Unknown',
            avatar: user['avatar'],
            isOnline: this.getIsOnlineFromUser(user),
          };
        } catch {
          // Bỏ qua friendship trỏ tới user đã bị xóa/không còn hợp lệ
          return null;
        }
      }),
    );

    return profiles.filter(
      (
        item,
      ): item is {
        userId: string;
        fullName: string;
        avatar: unknown;
        isOnline: boolean;
      } => Boolean(item),
    );
  }

  private async getRecentAcceptedFriendProfiles(
    userId: string,
    limit: number,
  ): Promise<
    Array<{
      userId: string;
      fullName: string;
      avatar: unknown;
      keptFriendsAt: unknown;
      isOnline: boolean;
    }>
  > {
    const friendships = await this.friendshipsService.findByUserId(userId);
    const accepted = friendships
      .filter((f) => f['status'] === FriendshipStatus.ACCEPTED)
      .sort(
        (a, b) =>
          new Date(this.asSafeString(b['updatedAt'])).getTime() -
          new Date(this.asSafeString(a['updatedAt'])).getTime(),
      );

    const seen = new Set<string>();
    const recentRelations: Array<{ friendId: string; keptFriendsAt: unknown }> =
      [];

    for (const rel of accepted) {
      const row = this.asRecord(rel);
      const friendId = this.getFriendIdFromRelation(row, userId);
      if (!friendId || seen.has(friendId)) continue;
      seen.add(friendId);
      recentRelations.push({ friendId, keptFriendsAt: row['updatedAt'] ?? null });
      if (recentRelations.length >= limit) break;
    }

    const details = await Promise.all(
      recentRelations.map(async (entry) => {
        try {
          const user = (await this.usersService.findById(
            entry.friendId,
          )) as unknown as Record<string, unknown>;
          return {
            userId: entry.friendId,
            fullName: this.asSafeString(user['fullName']).trim() || 'Unknown',
            avatar: user['avatar'],
            keptFriendsAt: entry.keptFriendsAt,
            isOnline: this.getIsOnlineFromUser(user),
          };
        } catch {
          return null;
        }
      }),
    );

    return details.filter(
      (
        item,
      ): item is {
        userId: string;
        fullName: string;
        avatar: unknown;
        keptFriendsAt: unknown;
        isOnline: boolean;
      } => Boolean(item),
    );
  }

  private countMatchedPhrases(text: string, phrases: string[]): number {
    if (!text) return 0;
    let count = 0;
    for (const p of phrases) {
      if (text.includes(p)) count += 1;
    }
    return count;
  }

  private getLevenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    let i: number, j: number;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    for (i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (i = 1; i <= b.length; i++) {
      for (j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) == a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1),
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  private suggestClosestNames(target: string, names: string[], limit: number = 3): string[] {
    const t = this.normalizeForIntent(target);
    if (!t) return [];
    
    const scored = names.map(name => {
      const n = this.normalizeForIntent(name);
      if (!n) return { name, score: 999 };
      let dist = this.getLevenshteinDistance(t, n);
      if (n.includes(t) || t.includes(n)) dist -= 2;
      return { name, score: Math.max(0, dist) };
    });

    scored.sort((a, b) => a.score - b.score);
    const maxAllowedDist = Math.max(3, Math.floor(t.length / 2));
    const unique = Array.from(new Set(scored.filter(s => s.score <= maxAllowedDist).map(s => s.name)));
    return unique.slice(0, limit);
  }

  private extractLookupNameFromDbQuery(normalizedMessage: string): string {
    if (!normalizedMessage) return '';

    const cleanup = (v: string): string =>
      v
        .replace(/\b(la gi|bao nhieu|khong|nao|voi toi|voi minh)\b/g, ' ')
        .replace(/\b(nguoi do|user do|ban do|nguoi nay)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const pronouns = new Set(['toi', 'minh', 'tui', 'tao', 'ban']);

    const patterns = [
      /\bcua\s+([a-z0-9 ]+?)(?:\s+la gi|\s+bao nhieu|\s+khong|$)/,
      /\b(?:phone|email|avatar|bio|ho ten|ten day du|full name|sdt|so dien thoai|dien thoai|online|last seen)\s+(?:cua\s+)?([a-z0-9 ]+?)(?:\s+la gi|\s+bao nhieu|\s+khong|$)/,
    ];

    for (const re of patterns) {
      const m = normalizedMessage.match(re);
      if (!m || !m[1]) continue;
      const name = cleanup(m[1]);
      if (!name || pronouns.has(name)) continue;
      return name;
    }
    return '';
  }

  private isPersonalFieldQuery(normalizedMessage: string): boolean {
    const personalPhrases = [
      'so dien thoai',
      'dien thoai',
      'sdt',
      'phone',
      'email',
      'avatar',
      'bio',
      'ho ten',
      'ten day du',
      'full name',
      'online',
      'last seen',
      'trang thai',
    ];
    return this.hasAnyPhrase(normalizedMessage, personalPhrases);
  }

  private async searchFriendUsersByName(
    currentUserId: string,
    name: string,
  ): Promise<
    Array<{
      userId: string;
      fullName: string;
      avatar: unknown;
      isOnline: boolean;
    }>
  > {
    const uid = this.asSafeString(currentUserId).trim();
    const keyword = this.normalizeForIntent(name);
    if (!uid || !keyword) return [];

    const friendships = await this.friendshipsService.findByUserId(uid);
    const acceptedFriendIds = friendships
      .filter((f) => f['status'] === FriendshipStatus.ACCEPTED)
      .map((f) =>
        f['requesterId']?.toString() === uid
          ? f['addresseeId']?.toString()
          : f['requesterId']?.toString(),
      )
      .filter((v): v is string => Boolean(v));

    const tokens = keyword.split(' ').filter(Boolean);
    const scored = await Promise.all(
      acceptedFriendIds.map(async (fid) => {
        try {
          const user = (await this.usersService.findById(
            fid,
          )) as unknown as Record<string, unknown>;
          const fullName = this.asSafeString(user['fullName']).trim();
          const normalizedName = this.normalizeForIntent(fullName);
          if (!normalizedName) return null;

          let score = 0;
          if (normalizedName === keyword) score += 100;
          if (normalizedName.includes(keyword) || keyword.includes(normalizedName)) {
            score += 40;
          }
          for (const t of tokens) {
            if (t && normalizedName.includes(t)) score += 10;
          }
          if (score <= 0) return null;

          return {
            userId: fid,
            fullName,
            avatar: user['avatar'],
            isOnline: this.getIsOnlineFromUser(user),
            score,
          };
        } catch {
          return null;
        }
      }),
    );

    return scored
      .filter(
        (
          item,
        ): item is {
          userId: string;
          fullName: string;
          avatar: unknown;
          isOnline: boolean;
          score: number;
        } => Boolean(item),
      )
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...rest }) => rest)
      .slice(0, 10);
  }

  private async forceReplyForPersonalFieldQuery(params: {
    currentUserId: string;
    normalizedUserMessage: string;
  }): Promise<{ reply: string; toolsUsed: string[] } | null> {
    const { currentUserId, normalizedUserMessage } = params;
    if (!this.isPersonalFieldQuery(normalizedUserMessage)) return null;

    const targetName = this.extractLookupNameFromDbQuery(normalizedUserMessage);
    if (!targetName) return null;

    const matches = await this.searchFriendUsersByName(currentUserId, targetName);
    if (matches.length === 0) return null;

    const top = matches[0];
    const user = (await this.usersService.findById(
      top.userId,
    )) as unknown as Record<string, unknown>;

    const name = this.asSafeString(user['fullName']) || targetName;
    const phone = this.asSafeString(user['phone']);
    const email = this.asSafeString(user['email']);
    const avatar = this.asSafeString(user['avatar']);
    const bio = this.asSafeString(user['bio']);
    const isOnline = this.getIsOnlineFromUser(user);
    const lastSeen = this.getLastSeenFromUser(user);

    const lines: string[] = [];
    if (
      this.hasAnyPhrase(normalizedUserMessage, [
        'so dien thoai',
        'dien thoai',
        'sdt',
        'phone',
      ])
    ) {
      lines.push(phone ? `Số điện thoại của ${name} là ${phone}.` : `${name} chưa có số điện thoại trong dữ liệu.`);
    }
    if (this.hasAnyPhrase(normalizedUserMessage, ['email'])) {
      lines.push(email ? `Email của ${name} là ${email}.` : `${name} chưa có email trong dữ liệu.`);
    }
    if (this.hasAnyPhrase(normalizedUserMessage, ['avatar'])) {
      lines.push(avatar ? `Avatar của ${name}: ${avatar}` : `${name} chưa có avatar trong dữ liệu.`);
    }
    if (this.hasAnyPhrase(normalizedUserMessage, ['bio'])) {
      lines.push(bio ? `Bio của ${name}: ${bio}` : `${name} chưa có bio.`);
    }
    if (this.hasAnyPhrase(normalizedUserMessage, ['ho ten', 'ten day du', 'full name'])) {
      lines.push(`Họ tên của user là ${name}.`);
    }
    if (this.hasAnyPhrase(normalizedUserMessage, ['online', 'last seen', 'trang thai'])) {
      lines.push(
        isOnline
          ? `${name} đang online.`
          : `${name} đang offline${lastSeen ? `, last seen: ${lastSeen}` : ''}.`,
      );
    }

    if (lines.length === 0) {
      lines.push(`Thông tin của ${name}:`);
      lines.push(phone ? `- Số điện thoại: ${phone}` : '- Số điện thoại: chưa có');
      lines.push(email ? `- Email: ${email}` : '- Email: chưa có');
      lines.push(avatar ? `- Avatar: ${avatar}` : '- Avatar: chưa có');
      lines.push(`- Trạng thái: ${isOnline ? 'online' : 'offline'}`);
      if (lastSeen) lines.push(`- Last seen: ${lastSeen}`);
    }

    return {
      reply: lines.join('\n'),
      toolsUsed: ['searchUserByName', 'getUserInfo'],
    };
  }

  private async forceReplyForAmbiguousDbFollowUp(params: {
    currentUserId: string;
    normalizedUserMessage: string;
  }): Promise<{ reply: string; toolsUsed: string[] } | null> {
    const { currentUserId, normalizedUserMessage } = params;

    const asksFriendNames = this.hasAnyPhrase(normalizedUserMessage, [
      'ten la gi',
      'ten gi',
      'ho ten',
      'la ai',
      'ai la',
    ]);
    if (!asksFriendNames) return null;

    const raw = await this.executeTool(
      'getFriendList',
      { userId: currentUserId, limit: 20 },
      { currentUserId },
    );

    const result = this.asRecord(raw);
    const friends = Array.isArray(result['friends'])
      ? (result['friends'] as Array<Record<string, unknown>>)
      : [];

    const names = friends
      .map((f) => this.asSafeString(f['fullName']).trim())
      .filter(Boolean);

    if (names.length === 0) {
      return {
        reply: 'Hiện bạn chưa có bạn bè nào trong dữ liệu app.',
        toolsUsed: ['getFriendList'],
      };
    }

    if (names.length === 1) {
      return {
        reply: `Bạn có 1 bạn bè, tên là ${names[0]}.`,
        toolsUsed: ['getFriendList'],
      };
    }

    const top = names.slice(0, 10).join(', ');
    const suffix = names.length > 10 ? ` và ${names.length - 10} người khác` : '';
    return {
      reply: `Tên bạn bè của bạn gồm: ${top}${suffix}.`,
      toolsUsed: ['getFriendList'],
    };
  }

  private async tryDirectDbResponse(params: {
    userId: string;
    normalizedUserMessage: string;
    isDbFollowUp: boolean;
    recentIntent: 'db' | 'chat' | 'delivery' | 'unknown';
    forceLookupName: string;
  }): Promise<{ reply: string; toolsUsed: string[] } | null> {
    const {
      userId,
      normalizedUserMessage,
      isDbFollowUp,
      recentIntent,
      forceLookupName,
    } = params;

    const asksFriendCount = this.hasAnyPhrase(normalizedUserMessage, [
      'bao nhieu ban',
      'so ban',
      'tong so ban',
    ]);
    const asksFriendNames =
      this.hasAnyPhrase(normalizedUserMessage, [
        'ten ban be',
        'ten ban toi',
        'ten ban be toi',
        'danh sach ban',
        'ban be toi la ai',
        'ban toi la ai',
        'la ai',
      ]) ||
      (isDbFollowUp &&
        recentIntent === 'db' &&
        this.hasAnyPhrase(normalizedUserMessage, ['ten la gi', 'ten gi', 'ho ten']));

    const asksPersonalField = this.isPersonalFieldQuery(normalizedUserMessage);

    if (asksPersonalField && forceLookupName) {
      const forced = await this.forceReplyForPersonalFieldQuery({
        currentUserId: userId,
        normalizedUserMessage,
      });
      if (forced) return forced;

      const friendsData = await this.getAcceptedFriendProfiles(userId);
      const friendNames = friendsData.map(f => this.asSafeString(f.fullName).trim()).filter(Boolean);
      const suggestions = this.suggestClosestNames(forceLookupName, friendNames);
      
      let reply = `Mình không tìm thấy bạn bè tên "${forceLookupName}" trong danh sách của bạn. Bạn kiểm tra lại tên giúp mình nhé.`;
      if (suggestions.length > 0) {
        reply = `Mình không tìm thấy bạn bè tên "${forceLookupName}". Có phải bạn muốn tìm ${suggestions.map(s => `"${s}"`).join(' hoặc ')} không?`;
      }

      return {
        reply,
        toolsUsed: ['searchUserByName'],
      };
    }

    if (asksPersonalField && !forceLookupName) {
      return {
        reply:
          'Bạn muốn xem thông tin của ai? Ví dụ: "số điện thoại của Wind là gì" hoặc "email của Wind là gì".',
        toolsUsed: [],
      };
    }

    if (!asksFriendCount && !asksFriendNames) return null;

    const friends = await this.getAcceptedFriendProfiles(userId);
    const count = friends.length;
    const names = friends
      .map((f) => this.asSafeString(f.fullName).trim())
      .filter(Boolean);

    if (count === 0) {
      return {
        reply: 'Hiện bạn chưa có bạn bè nào trong dữ liệu app.',
        toolsUsed: ['getFriendList'],
      };
    }

    if (asksFriendCount && !asksFriendNames) {
      return {
        reply: count === 1 ? 'Bạn có 1 bạn bè.' : `Bạn có ${count} bạn bè.`,
        toolsUsed: ['getFriendCount'],
      };
    }

    if (!asksFriendCount && asksFriendNames) {
      if (names.length === 1) {
        return {
          reply: `Bạn có 1 bạn bè, tên là ${names[0]}.`,
          toolsUsed: ['getFriendList'],
        };
      }
      return {
        reply: `Bạn có ${count} bạn bè. Tên gồm: ${names.join(', ')}.`,
        toolsUsed: ['getFriendList'],
      };
    }

    // Trường hợp user hỏi cả số lượng và tên trong cùng 1 câu.
    if (names.length === 1) {
      return {
        reply: `Bạn có 1 bạn bè, tên là ${names[0]}.`,
        toolsUsed: ['getFriendCount', 'getFriendList'],
      };
    }

    return {
      reply: `Bạn có ${count} bạn bè. Tên gồm: ${names.join(', ')}.`,
      toolsUsed: ['getFriendCount', 'getFriendList'],
    };
  }

  private extractRequestedMessageLimit(
    normalizedMessage: string,
    fallback = 10,
    max = 60,
  ): number {
    const m1 = normalizedMessage.match(
      /(?:dua|lay|gui|cho)\s*(\d{1,3})\s*(?:tin|tin nhan)\b/,
    );
    const m2 = normalizedMessage.match(/(\d{1,3})\s*(?:tin|tin nhan)\b/);
    const raw = m1?.[1] ?? m2?.[1];
    return this.parsePositiveInt(raw, fallback, 1, max);
  }

  private extractPrivatePeerName(normalizedMessage: string): string {
    const cleanup = (v: string): string =>
      v
        .replace(
          /\b(nhan|chat|noi|tin|rieng|gan day nhat|gan day|dua|noi dung|chi tiet|la gi|cho|voi)\b/g,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim();

    const pronouns = new Set(['toi', 'minh', 'tui', 'ban']);
    const patterns = [
      /\b(?:tin nhan|nhan tin)(?:\s+rieng)?\s+voi\s+([a-z0-9 ]+?)(?:\s|$)/,
      /\btoi voi\s+([a-z0-9 ]+?)\s+(?:nhan|chat|noi)\b/,
      /\b(?:chat|nhan tin|noi chuyen|gui tin) (?:rieng |)voi\s+([a-z0-9 ]+?)(?:\s|$)/,
      /\b(?:nhan|gui) cho\s+([a-z0-9 ]+?)(?:\s|$)/,
      /\bvoi\s+([a-z0-9 ]+?)\s+(?:nhan|chat|noi)\b/,
    ];

    for (const re of patterns) {
      const m = normalizedMessage.match(re);
      if (!m || !m[1]) continue;
      const name = cleanup(m[1]);
      if (!name || pronouns.has(name)) continue;
      return name;
    }

    return '';
  }

  private extractGroupName(normalizedMessage: string): string {
    const m = normalizedMessage.match(
      /\b(?:nhom|group)\s+([a-z0-9 ]+?)(?:\s+(?:nhan|chat|noi|gan|dua|la gi|noi dung|chi tiet)|$)/,
    );
    if (!m || !m[1]) return '';
    return m[1].replace(/\s+/g, ' ').trim();
  }

  private isChatDetailFollowUp(normalizedMessage: string): boolean {
    return this.hasAnyPhrase(normalizedMessage, [
      'chi tiet',
      'thong tin chi tiet',
      'dua thong tin',
      'dua noi dung',
      'noi dung',
      'la gi',
    ]);
  }

  private async inferRecentPrivatePeerFromConversation(params: {
    chatbotConversationId?: string;
    userId: string;
  }): Promise<string> {
    const { chatbotConversationId, userId } = params;
    if (!chatbotConversationId) return '';
    if (!Types.ObjectId.isValid(chatbotConversationId)) return '';
    if (!Types.ObjectId.isValid(userId)) return '';

    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(chatbotConversationId);

    const rows = await this.chatbotMessageModel
      .find({ userId: uid, conversationId: cid, role: 'user' })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('content')
      .lean()
      .exec();

    for (const row of rows) {
      const norm = this.normalizeForIntent(this.asSafeString(row.content));
      const name = this.extractPrivatePeerName(norm);
      if (name) return name;
    }

    return '';
  }

  private async resolvePrivateConversationByPeerName(params: {
    userId: string;
    peerName: string;
  }): Promise<{ conversationId: string; peerDisplayName: string } | null> {
    const { userId, peerName } = params;
    if (!Types.ObjectId.isValid(userId)) return null;

    const uid = new Types.ObjectId(userId);
    const target = this.normalizeForIntent(peerName);
    if (!target) return null;

    const candidates = await this.conversationModel
      .find({
        type: ConversationType.PRIVATE,
        'members.userId': uid,
      })
      .select('_id members updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean()
      .exec();

    const peerIds = new Set<string>();
    for (const c of candidates) {
      const members = Array.isArray(c.members)
        ? (c.members as Array<Record<string, unknown>>)
        : [];
      for (const m of members) {
        const mid = this.asSafeString(m['userId']);
        if (mid && mid !== userId) peerIds.add(mid);
      }
    }

    const nameMap = new Map<string, string>();
    await Promise.all(
      Array.from(peerIds).map(async (pid) => {
        try {
          const u = (await this.usersService.findById(
            pid,
          )) as unknown as Record<string, unknown>;
          nameMap.set(pid, this.asSafeString(u['fullName']).trim());
        } catch {
          nameMap.set(pid, '');
        }
      }),
    );

    const targetTokens = target.split(' ').filter(Boolean);
    let best: { conversationId: string; peerDisplayName: string; score: number } | null =
      null;

    for (const c of candidates) {
      const members = Array.isArray(c.members)
        ? (c.members as Array<Record<string, unknown>>)
        : [];
      const peerId = members
        .map((m) => this.asSafeString(m['userId']))
        .find((id) => id && id !== userId);
      if (!peerId) continue;

      const fullName = nameMap.get(peerId) ?? '';
      const normalizedName = this.normalizeForIntent(fullName);
      if (!normalizedName) continue;

      let score = 0;
      if (normalizedName === target) score += 100;
      if (
        normalizedName.includes(target) ||
        target.includes(normalizedName)
      ) {
        score += 40;
      }
      for (const t of targetTokens) {
        if (t && normalizedName.includes(t)) score += 10;
      }
      if (score <= 0) continue;

      const candidate = {
        conversationId: this.asSafeString(c._id),
        peerDisplayName: fullName || peerName,
        score,
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    if (!best) return null;
    return {
      conversationId: best.conversationId,
      peerDisplayName: best.peerDisplayName,
    };
  }

  private formatChatMessagesForUser(params: {
    title: string;
    messages: unknown[];
  }): string {
    const { title, messages } = params;
    if (!Array.isArray(messages) || messages.length === 0) {
      return `${title}\nHiện chưa có tin nhắn hiển thị.`;
    }

    const formatLocalTime = (value: unknown): string => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value as string);
      if (Number.isNaN(d.getTime())) return '';
      const tzOffset = 7 * 60 * 60 * 1000;
      const local = new Date(d.getTime() + tzOffset);
      const hh = String(local.getUTCHours()).padStart(2, '0');
      const mm = String(local.getUTCMinutes()).padStart(2, '0');
      const dd = String(local.getUTCDate()).padStart(2, '0');
      const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = local.getUTCFullYear();
      return `${hh}:${mm} ${dd}/${MM}/${yyyy}`;
    };

    const scrubLinks = (text: string): string =>
      text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

    const lines = messages.map((m) => {
      const r = this.asRecord(m);
      const type = this.asSafeString(r['type']).toUpperCase();
      const sender = this.asSafeString(r['senderName']).trim() || 'Unknown';
      const time = formatLocalTime(r['createdAt']);
      const timePrefix = time ? `[${time}] ` : '';
      let content = this.asSafeString(r['content']).trim() || '(trống)';

      if (type !== 'TEXT') {
        content = scrubLinks(content);
        if (!content) content = '(trống)';
      }

      if (type === 'SYSTEM') return `- ${timePrefix}[Sự kiện] ${content}`;
      return `- ${timePrefix}${sender}: ${content}`;
    });

    return `${title}\n${lines.join('\n')}`;
  }

  private async tryDirectChatResponse(params: {
    userId: string;
    normalizedUserMessage: string;
    chatbotConversationId?: string;
    targetConversationId?: string;
    recentIntent: 'db' | 'chat' | 'delivery' | 'unknown';
  }): Promise<{ reply: string; toolsUsed: string[] } | null> {
    const {
      userId,
      normalizedUserMessage,
      chatbotConversationId,
      targetConversationId,
      recentIntent,
    } = params;

    const explicitChatQuery = this.hasAnyPhrase(normalizedUserMessage, [
      'nhan tin',
      'chat',
      'noi gi',
      'noi dung',
      'gan day',
      'dua',
      'tom tat',
    ]);
    const followUpChat =
      recentIntent === 'chat' && this.isChatDetailFollowUp(normalizedUserMessage);

    if (!explicitChatQuery && !followUpChat) return null;

    const privatePeerFromText = this.extractPrivatePeerName(normalizedUserMessage);
    let peerName = privatePeerFromText;
    if (!peerName && followUpChat) {
      peerName = await this.inferRecentPrivatePeerFromConversation({
        chatbotConversationId,
        userId,
      });
    }

    const asksPrivate =
      Boolean(peerName) ||
      this.hasAnyPhrase(normalizedUserMessage, [
        'rieng',
        'chat rieng',
        '1 1',
        '1-1',
        'toi voi',
      ]);

    const asksGroup = this.hasAnyPhrase(normalizedUserMessage, ['nhom', 'group']);
    const limit = this.extractRequestedMessageLimit(normalizedUserMessage, 10, 60);

    if (asksPrivate && peerName) {
      const resolved = await this.resolvePrivateConversationByPeerName({
        userId,
        peerName,
      });
      if (!resolved) {
        const friendsData = await this.getAcceptedFriendProfiles(userId);
        const friendNames = friendsData.map(f => this.asSafeString(f.fullName).trim()).filter(Boolean);
        const suggestions = this.suggestClosestNames(peerName, friendNames);
        
        let reply = `Mình không tìm thấy chat riêng giữa bạn và "${peerName}". Bạn kiểm tra lại tên hoặc xác nhận hai bạn đã có cuộc trò chuyện 1-1 nhé.`;
        if (suggestions.length > 0) {
          reply = `Mình không tìm thấy chat riêng với "${peerName}". Có phải bạn muốn nhắc đến ${suggestions.map(s => `"${s}"`).join(' hoặc ')} không?`;
        }
        
        return {
          reply,
          toolsUsed: ['getChatMessages'],
        };
      }

      const raw = (await this.getChatMessagesForAi({
        userId,
        conversationId: resolved.conversationId,
        limit,
      })) as Record<string, unknown>;

      const messages = Array.isArray(raw['messages'])
        ? (raw['messages'] as unknown[])
        : [];

      const reply = this.formatChatMessagesForUser({
        title: `Chat riêng với ${resolved.peerDisplayName} (${messages.length} tin gần nhất):`,
        messages,
      });

      return { reply, toolsUsed: ['getChatMessages'] };
    }

    if (asksGroup) {
      const groupName = this.extractGroupName(normalizedUserMessage);
      if (groupName) {
        try {
          const raw = (await this.getChatMessagesForAi({
            userId,
            conversationId: groupName,
            limit,
          })) as Record<string, unknown>;

          const convType = this.asSafeString(raw['conversationType']).trim();
          if (convType !== ConversationType.GROUP) {
             throw new Error('Not a group');
          }

          const convName = this.asSafeString(raw['conversationName']).trim() || groupName;
          const messages = Array.isArray(raw['messages'])
            ? (raw['messages'] as unknown[])
            : [];
          const reply = this.formatChatMessagesForUser({
            title: `Nhóm ${convName} (${messages.length} tin gần nhất):`,
            messages,
          });
          return { reply, toolsUsed: ['getChatMessages'] };
        } catch {
          const uid = new Types.ObjectId(userId);
          const groups = await this.conversationModel
            .find({ type: ConversationType.GROUP, 'members.userId': uid })
            .select('name')
            .lean()
            .exec();
          const groupNames = groups.map(g => this.asSafeString(g.name).trim()).filter(Boolean);
          const suggestions = this.suggestClosestNames(groupName, groupNames);
          
          let reply = `Mình chưa lấy được dữ liệu nhóm theo tên "${groupName}". Bạn kiểm tra lại tên nhóm nhé.`;
          if (suggestions.length > 0) {
            reply = `Mình không tìm thấy nhóm "${groupName}". Có phải bạn muốn nhắc đến nhóm ${suggestions.map(s => `"${s}"`).join(' hoặc ')} không?`;
          }
          return {
            reply,
            toolsUsed: ['getChatMessages'],
          };
        }
      }
    }

    if (followUpChat && targetConversationId) {
      const raw = (await this.getChatMessagesForAi({
        userId,
        conversationId: targetConversationId,
        limit,
      })) as Record<string, unknown>;
      const convName = this.asSafeString(raw['conversationName']).trim();
      const messages = Array.isArray(raw['messages'])
        ? (raw['messages'] as unknown[])
        : [];
      const reply = this.formatChatMessagesForUser({
        title: `${convName ? `Cuộc trò chuyện ${convName}` : 'Cuộc trò chuyện'} (${messages.length} tin gần nhất):`,
        messages,
      });
      return { reply, toolsUsed: ['getChatMessages'] };
    }

    return null;
  }

  private extractPseudoFunctionTags(text: string): Array<{
    fullMatch: string;
    name: string;
    rawArgs: string;
  }> {
    const out: Array<{ fullMatch: string; name: string; rawArgs: string }> = [];
    const re = /<function=([a-zA-Z0-9_]+)>\s*([\s\S]*?)\s*<\/function>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        fullMatch: m[0],
        name: m[1],
        rawArgs: m[2],
      });
    }
    return out;
  }

  private summarizeToolResultForInline(toolName: string, result: unknown): string {
    const r = this.asRecord(result);
    switch (toolName) {
      case 'getFriendCount': {
        const count = typeof r['count'] === 'number' ? r['count'] : null;
        if (count == null) return this.asSafeString(r['message']) || 'dữ liệu bạn bè';
        if (count === 1) return '1 người bạn';
        return `${count} bạn`;
      }
      case 'getFriendList': {
        const total = typeof r['total'] === 'number' ? r['total'] : null;
        if (total != null) {
          if (total === 1) return '1 người bạn';
          return `${total} bạn`;
        }
        const friends = Array.isArray(r['friends']) ? r['friends'] : [];
        const n = friends.length;
        if (n === 1) return '1 người bạn';
        return `${n} bạn`;
      }
      case 'getRecentFriends': {
        const list = Array.isArray(r['recentFriends']) ? r['recentFriends'] : [];
        return `${list.length} bạn gần đây`;
      }
      case 'getPendingFriendRequests': {
        const count = typeof r['count'] === 'number' ? r['count'] : 0;
        return `${count} lời mời kết bạn đang chờ`;
      }
      case 'getUserInfo': {
        const name = this.asSafeString(r['fullName']).trim();
        return name || 'thông tin người dùng';
      }
      case 'searchUserByName': {
        const count = typeof r['count'] === 'number' ? r['count'] : 0;
        return `${count} kết quả`;
      }
      case 'getChatMessages': {
        const count = typeof r['count'] === 'number' ? r['count'] : 0;
        return `${count} tin nhắn`;
      }
      case 'searchChatMessages': {
        const count = typeof r['count'] === 'number' ? r['count'] : 0;
        return `${count} kết quả tin nhắn`;
      }
      default:
        return this.asSafeString(r['message']) || 'kết quả';
    }
  }

  private async resolvePseudoFunctionTagsInText(params: {
    text: string;
    currentUserId: string;
    targetConversationId?: string;
    normalizedUserMessage: string;
    forceLookupName: string;
    forceLookupByName: boolean;
  }): Promise<{ text: string; usedTools: string[]; hadTags: boolean }> {
    const {
      text,
      currentUserId,
      targetConversationId,
      normalizedUserMessage,
      forceLookupName,
      forceLookupByName,
    } = params;

    const tags = this.extractPseudoFunctionTags(text);
    if (tags.length === 0) {
      return { text, usedTools: [], hadTags: false };
    }

    let next = text;
    const usedTools: string[] = [];

    for (const tag of tags) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(tag.rawArgs);
        if (parsed && typeof parsed === 'object') {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }

      let toolResult: unknown;
      try {
        toolResult = await this.executeTool(tag.name, args, {
          currentUserId,
          lockedConversationId: targetConversationId,
          normalizedUserMessage,
          forceLookupName,
          forceLookupByName,
        });
      } catch (e: unknown) {
        toolResult = { error: this.safeErrMessage(e) };
      }

      usedTools.push(tag.name);
      const replacement = this.summarizeToolResultForInline(tag.name, toolResult);
      next = next.split(tag.fullMatch).join(replacement);
    }

    next = next
      .replace(/<function=[^>]+>[\s\S]*?<\/function>/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      text: next,
      usedTools: Array.from(new Set(usedTools)),
      hadTags: true,
    };
  }

  private isDbFollowUpQuery(normalizedMessage: string): boolean {
    if (!normalizedMessage) return false;

    const explicit = [
      'ten la gi',
      'ten gi',
      'ho ten la gi',
      'ho ten',
      'sdt la gi',
      'so dien thoai la gi',
      'email la gi',
      'avatar la gi',
      'online khong',
      'last seen',
      'trang thai',
      'la ai',
      'ai la',
    ];
    if (this.hasAnyPhrase(normalizedMessage, explicit)) return true;

    const shortFollowUp = normalizedMessage.split(' ').length <= 4;
    if (!shortFollowUp) return false;

    return this.hasAnyPhrase(normalizedMessage, [
      'ten',
      'ho ten',
      'sdt',
      'dien thoai',
      'phone',
      'email',
      'avatar',
      'bio',
      'online',
      'last seen',
    ]);
  }

  private isSensitiveInfoQuery(normalizedMessage: string): boolean {
    if (!normalizedMessage) return false;
    const sensitivePhrases = [
      'mat khau',
      'password',
      'passcode',
      'otp',
      'ma otp',
      'ma xac thuc',
      '2fa',
      'token',
      'ma pin',
      'pin',
      'cvv',
      'cvc',
      'so the',
      'card number',
      'ma the',
      'mat khau cua',
    ];
    return this.hasAnyPhrase(normalizedMessage, sensitivePhrases);
  }

  private async inferRecentIntentFromConversation(params: {
    conversationId?: string;
    userId: string;
  }): Promise<'db' | 'chat' | 'delivery' | 'unknown'> {
    const { conversationId, userId } = params;
    if (!conversationId) return 'unknown';
    if (!Types.ObjectId.isValid(conversationId)) return 'unknown';
    if (!Types.ObjectId.isValid(userId)) return 'unknown';

    const uid = new Types.ObjectId(userId);
    const cid = new Types.ObjectId(conversationId);

    const rows = await this.chatbotMessageModel
      .find({ userId: uid, conversationId: cid, role: 'assistant' })
      .sort({ createdAt: -1 })
      .limit(6)
      .select('toolsUsed content')
      .lean()
      .exec();

    const dbToolNames = new Set([
      'getFriendCount',
      'getFriendList',
      'getRecentFriends',
      'getPendingFriendRequests',
      'getUserInfo',
      'searchUserByName',
    ]);
    const chatToolNames = new Set(['getChatMessages', 'searchChatMessages']);

    for (const row of rows) {
      const toolsUsed = Array.isArray(row.toolsUsed)
        ? row.toolsUsed.map((x) => this.asSafeString(x))
        : [];

      if (toolsUsed.some((t) => dbToolNames.has(t))) return 'db';
      if (toolsUsed.some((t) => chatToolNames.has(t))) return 'chat';

      const contentNorm = this.normalizeForIntent(this.asSafeString(row.content));
      if (
        this.hasAnyPhrase(contentNorm, [
          'delivery',
          'giao hang',
          'don hang',
          'van chuyen',
          'ship',
        ])
      ) {
        return 'delivery';
      }
    }

    return 'unknown';
  }

  private async ensureConversationMember(
    conversationId: string,
    userId: string,
  ): Promise<{ conversation: ConversationDocument }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error('userId không hợp lệ');
    }
    const uid = new Types.ObjectId(userId);

    // conversationId có thể là ObjectId hoặc tên conversation (do AI suy luận).
    // CHỈ lookup theo _id khi conversationId là ObjectId hợp lệ.
    // Nếu là tên (string), BỎ QUA findOne và chuyển thẳng sang fuzzy matching —
    // vì findOne({ 'members.userId': uid }) không có filter tên sẽ trả về
    // conversation mới nhất của user, gây nhầm lẫn hoàn toàn.
    let conversation: ConversationDocument | null = null;

    if (Types.ObjectId.isValid(conversationId)) {
      conversation = await this.conversationModel
        .findOne({
          _id: new Types.ObjectId(conversationId),
          'members.userId': uid,
        })
        .lean(false)
        .exec();
    }

    // Nếu conversationId không phải ObjectId: attempt fuzzy match theo name (không dấu)
    if (!conversation && !Types.ObjectId.isValid(conversationId)) {
      const raw = conversationId.trim();
      if (!raw) throw new Error('conversationId không hợp lệ');

      const normalize = (s: string) =>
        s
          .toLowerCase()
          .replace(/[đ]/g, 'd')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[_-]+/g, ' ')
          .replace(/[^a-z0-9 ]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const target = normalize(raw);
      const targetTokens = new Set(target.split(' ').filter(Boolean));

      const candidates = await this.conversationModel
        .find({ 'members.userId': uid })
        .select('_id name updatedAt')
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean()
        .exec();

      const scored: Array<{ id: string; score: number }> = [];
      for (const c of candidates) {
        const name = typeof c.name === 'string' ? c.name : '';
        const n = normalize(name);
        if (!n) continue;

        let score = 0;
        if (n === target) score += 100;
        if (n.includes(target) || target.includes(n)) score += 30;

        const tokens = n.split(' ').filter(Boolean);
        let overlap = 0;
        for (const t of tokens) {
          if (targetTokens.has(t)) overlap += 1;
        }
        score += overlap * 5;

        // Ưu tiên nhóm có chữ "team" / "nhom" nếu target có
        if (targetTokens.has('team') && tokens.includes('team')) score += 2;
        if (targetTokens.has('nhom') && tokens.includes('nhom')) score += 2;

        scored.push({ id: String(c._id), score });
      }

      scored.sort((a, b) => b.score - a.score);
      const top = scored.filter((x) => x.score >= 10).slice(0, 5);

      // Ưu tiên SCORE (độ khớp tên) trước.
      // visibleCount chỉ dùng làm tiebreaker khi score sát nhau (<= 15 điểm chênh lệch).
      // Tránh lỗi cũ: conversation khác (nhiều message hơn) thắng nhầm conversation đúng tên.
      if (top.length > 0) {
        const uidObj = uid;

        // Nếu candidate đầu tiên đã có score rất cao (>= 80 = near-exact match),
        // chọn ngay mà không cần đếm messages — tránh bị override nhầm.
        const topScore = top[0].score;

        // Lấy tất cả candidates trong cùng "score tier" (trong vòng 15 điểm của topScore)
        const sameTier = top.filter((x) => x.score >= topScore - 15);

        let bestId: string | null = null;
        let bestVisibleCount = -1;
        let bestCandidateScore = -1;

        for (const t of sameTier) {
          if (!Types.ObjectId.isValid(t.id)) continue;
          const cid = new Types.ObjectId(t.id);
          const visibleCount = await this.messageModel.countDocuments({
            conversationId: cid,
            isRecalled: false,
            deletedBy: { $ne: uidObj },
          });

          this.logger.debug(
            `[fuzzy] candidate id=${t.id} score=${t.score} visibleCount=${visibleCount}`,
          );

          // Trong cùng tier: ưu tiên score cao hơn;
          // chỉ ưu tiên visibleCount khi score bằng nhau.
          if (
            t.score > bestCandidateScore ||
            (t.score === bestCandidateScore && visibleCount > bestVisibleCount)
          ) {
            bestCandidateScore = t.score;
            bestVisibleCount = visibleCount;
            bestId = t.id;
          }
        }

        if (bestId) {
          conversation = await this.conversationModel
            .findOne({ _id: new Types.ObjectId(bestId), 'members.userId': uid })
            .lean(false)
            .exec();
        }
      }
    }

    if (!conversation) {
      throw new Error('Bạn không có quyền truy cập cuộc trò chuyện này');
    }

    this.logger.debug(
      `Resolved conversation for '${conversationId}' -> id=${String(conversation._id)}`,
    );
    return { conversation };
  }

  private friendlyMessageTypeLabel(t: string): string {
    switch (t) {
      case 'TEXT': return 'tin nhắn văn bản';
      case 'IMAGE': return 'hình ảnh';
      case 'VIDEO': return 'video';
      case 'FILE': return 'file đính kèm';
      case 'VOICE': return 'tin nhắn thoại';
      case 'LOCATION': return 'vị trí';
      case 'CONTACT': return 'danh bạ';
      case 'SYSTEM': return 'thông báo hệ thống';
      default: return String(t || 'không xác định');
    }
  }

  /**
   * Chuyển đổi nội dung tin nhắn SYSTEM (dạng pipe-separated) thành câu tự nhiên.
   * Format thường gặp: "ACTION|param1|param2|..."
   * Ví dụ:
   *   "LEAVE_GROUP|Wind"            -> "Wind đã rời nhóm"
   *   "ADD_MEMBER|Nam|Wind"         -> "Wind đã thêm Nam vào nhóm"
   *   "REMOVE_MEMBER|Nam|Wind"      -> "Wind đã xoá Nam khỏi nhóm"
   *   "UPDATE_GROUP_NAME|Nhóm mới"  -> "Tên nhóm đã được đổi thành \"Nhóm mới\""
   *   "CREATE_GROUP|Wind"           -> "Wind đã tạo nhóm"
   *   "MAKE_ADMIN|Nam|Wind"         -> "Wind đã đặt Nam làm quản trị viên"
   *   "REVOKE_ADMIN|Nam|Wind"       -> "Wind đã thu hồi quyền quản trị của Nam"
   *   "DISSOLVE_GROUP|Wind"         -> "Wind đã giải tán nhóm"
   */
  private parseSystemMessageContent(raw: string): string {
    if (!raw || !raw.trim()) return '(thông báo hệ thống)';
    const parts = raw.split('|').map((p) => p.trim());
    const action = parts[0]?.toUpperCase() ?? '';
    switch (action) {
      case 'LEAVE_GROUP': {
        const who = parts[1] || 'Ai đó';
        return `${who} đã rời khỏi nhóm`;
      }
      case 'ADD_MEMBER': {
        const added = parts[1] || 'ai đó';
        const by = parts[2] || 'ai đó';
        return `${by} đã thêm ${added} vào nhóm`;
      }
      case 'REMOVE_MEMBER': {
        const removed = parts[1] || 'ai đó';
        const by = parts[2] || 'ai đó';
        return `${by} đã xoá ${removed} khỏi nhóm`;
      }
      case 'UPDATE_GROUP_NAME': {
        const newName = parts[1] || '(không rõ)';
        return `Tên nhóm đã được đổi thành "${newName}"`;
      }
      case 'UPDATE_GROUP_AVATAR': {
        const by = parts[1] || 'ai đó';
        return `${by} đã cập nhật ảnh đại diện nhóm`;
      }
      case 'CREATE_GROUP': {
        const creator = parts[1] || 'ai đó';
        return `${creator} đã tạo nhóm`;
      }
      case 'MAKE_ADMIN': {
        const member = parts[1] || 'ai đó';
        const by = parts[2] || 'ai đó';
        return `${by} đã đặt ${member} làm quản trị viên`;
      }
      case 'REVOKE_ADMIN': {
        const member = parts[1] || 'ai đó';
        const by = parts[2] || 'ai đó';
        return `${by} đã thu hồi quyền quản trị của ${member}`;
      }
      case 'DISSOLVE_GROUP': {
        const by = parts[1] || 'ai đó';
        return `${by} đã giải tán nhóm`;
      }
      case 'JOIN_GROUP': {
        const who = parts[1] || 'Ai đó';
        return `${who} đã tham gia nhóm`;
      }
      case 'TRANSFER_ADMIN': {
        const to = parts[1] || 'ai đó';
        const by = parts[2] || 'ai đó';
        return `${by} đã chuyển quyền trưởng nhóm cho ${to}`;
      }
      default:
        // Không nhận ra action: trả về câu chung kèm nội dung gốc để AI hiểu
        return raw.trim();
    }
  }

  private async mapSenderNames(
    senderIds: string[],
  ): Promise<Record<string, string>> {
    const uniq = Array.from(new Set(senderIds.filter(Boolean)));
    const out: Record<string, string> = {};
    await Promise.all(
      uniq.map(async (id) => {
        try {
          const u = await this.usersService.findById(id);
          const name =
            String((u?.fullName ?? u?.displayName ?? '') as unknown).trim() ||
            id;
          out[id] = name;
        } catch {
          out[id] = id;
        }
      }),
    );
    return out;
  }

  private async getChatMessagesForAi(params: {
    userId: string;
    conversationId: string;
    limit: number;
  }): Promise<unknown> {
    const { userId, conversationId, limit } = params;
    const { conversation } = await this.ensureConversationMember(
      conversationId,
      userId,
    );

    const uid = new Types.ObjectId(userId);
    const cid =
      conversation._id instanceof Types.ObjectId
        ? conversation._id
        : new Types.ObjectId(String(conversation._id));

    const rows = await this.messageModel
      .find({
        conversationId: cid,
        isRecalled: false,
        deletedBy: { $ne: uid },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    // Nếu user nhìn thấy 0 tin nhắn, trả thêm chẩn đoán để AI giải thích đúng
    // (vd: user đã xoá cuộc trò chuyện, hoặc tin nhắn bị thu hồi).
    let visibility: {
      total: number;
      visible: number;
      recalled: number;
      deletedForUser: number;
    } | null = null;
    if (rows.length === 0) {
      const [total, recalled, deletedForUser] = await Promise.all([
        this.messageModel.countDocuments({ conversationId: cid }),
        this.messageModel.countDocuments({
          conversationId: cid,
          isRecalled: true,
        }),
        this.messageModel.countDocuments({
          conversationId: cid,
          deletedBy: uid,
        }),
      ]);
      visibility = {
        total,
        visible: 0,
        recalled,
        deletedForUser,
      };
    }

    const totalInConversation = await this.messageModel.countDocuments({
      conversationId: cid,
    });
    this.logger.debug(
      `getChatMessages resolvedId=${String(conversation._id)} name="${conversation.name ?? ''}" totalDocs=${totalInConversation} visibleRows=${rows.length} limit=${limit}`,
    );

    const senderIds = rows.map((m) => {
      const r = this.asRecord(m);
      return this.asSafeString(r['senderId']);
    });
    const nameMap = await this.mapSenderNames(senderIds);

    const messages = rows
      .reverse()
      .map((m) => {
        const r = this.asRecord(m);
        const id = this.asSafeString(r['_id']);
        const senderId = this.asSafeString(r['senderId']);
        const type = this.asSafeString(r['messageType'] ?? r['type'] ?? 'TEXT');
        const contentRaw = this.asSafeString(r['content'] ?? '');

        let content: string;
        if (type === 'TEXT') {
          content = contentRaw || '(tin nhắn rỗng)';
        } else if (type === 'SYSTEM') {
          // Parse sự kiện hệ thống thành câu tự nhiên
          content = this.parseSystemMessageContent(contentRaw);
        } else if (contentRaw) {
          // IMAGE, VIDEO, FILE, VOICE, LOCATION, CONTACT: có thể kèm caption
          content = `[${this.friendlyMessageTypeLabel(type)}]${contentRaw ? ': ' + contentRaw : ''}`;
        } else {
          content = `[${this.friendlyMessageTypeLabel(type)}]`;
        }

        // Bổ sung thông tin chi tiết từ metadata (tên file, thời lượng)
        const metadata = r['metadata'] as Record<string, unknown> | undefined;
        if (metadata) {
          if (type === 'FILE' && metadata.fileName) {
            content += ` (Tên file: ${metadata.fileName})`;
          }
          if ((type === 'VOICE' || type === 'VIDEO') && metadata.duration) {
            content += ` (Thời lượng: ${metadata.duration} giây)`;
          }
        }

        // Bổ sung thông tin cảm xúc (reactions)
        const reactions = r['reactions'] as Array<Record<string, unknown>> | undefined;
        if (reactions && Array.isArray(reactions) && reactions.length > 0) {
          const rxCounts: Record<string, number> = {};
          for (const rx of reactions) {
            const rt = rx['reactionType'] as string;
            if (rt) rxCounts[rt] = (rxCounts[rt] || 0) + 1;
          }
          const rxStrs = Object.entries(rxCounts).map(([k, v]) => `${k} x${v}`);
          if (rxStrs.length > 0) {
            content += ` [Cảm xúc: ${rxStrs.join(', ')}]`;
          }
        }

        return {
          id,
          senderId,
          senderName: nameMap[senderId] ?? senderId,
          type,
          content,
          createdAt: r['createdAt'] ?? null,
        };
      })
      .filter((x) => x.id && x.senderId);

    return {
      conversationId: String(conversation._id),
      conversationName: conversation.name ?? '',
      conversationType: conversation.type ?? '',
      count: messages.length,
      messages,
      visibility,
    };
  }

  private async searchChatMessagesForAi(params: {
    userId: string;
    conversationId: string;
    query: string;
    limit: number;
  }): Promise<unknown> {
    const { userId, conversationId, query, limit } = params;
    if (!query) return { conversationId, count: 0, messages: [] };
    const { conversation } = await this.ensureConversationMember(
      conversationId,
      userId,
    );

    const uid = new Types.ObjectId(userId);
    const cid =
      conversation._id instanceof Types.ObjectId
        ? conversation._id
        : new Types.ObjectId(String(conversation._id));

    const rows = await this.messageModel
      .find({
        conversationId: cid,
        isRecalled: false,
        deletedBy: { $ne: uid },
        content: { $regex: query, $options: 'i' },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const senderIds = rows.map((m) => {
      const r = this.asRecord(m);
      return this.asSafeString(r['senderId']);
    });
    const nameMap = await this.mapSenderNames(senderIds);

    const messages = rows
      .map((m) => {
        const r = this.asRecord(m);
        const id = this.asSafeString(r['_id']);
        const senderId = this.asSafeString(r['senderId']);
        const type = this.asSafeString(r['messageType'] ?? r['type'] ?? 'TEXT');
        const contentRaw = this.asSafeString(r['content'] ?? '');

        let content: string;
        if (type === 'TEXT') {
          content = contentRaw || '(tin nhắn rỗng)';
        } else if (type === 'SYSTEM') {
          content = this.parseSystemMessageContent(contentRaw);
        } else if (contentRaw) {
          content = `[${this.friendlyMessageTypeLabel(type)}]${contentRaw ? ': ' + contentRaw : ''}`;
        } else {
          content = `[${this.friendlyMessageTypeLabel(type)}]`;
        }

        // Bổ sung thông tin chi tiết từ metadata (tên file, thời lượng)
        const metadata = r['metadata'] as Record<string, unknown> | undefined;
        if (metadata) {
          if (type === 'FILE' && metadata.fileName) {
            content += ` (Tên file: ${metadata.fileName})`;
          }
          if ((type === 'VOICE' || type === 'VIDEO') && metadata.duration) {
            content += ` (Thời lượng: ${metadata.duration} giây)`;
          }
        }

        // Bổ sung thông tin cảm xúc (reactions)
        const reactions = r['reactions'] as Array<Record<string, unknown>> | undefined;
        if (reactions && Array.isArray(reactions) && reactions.length > 0) {
          const rxCounts: Record<string, number> = {};
          for (const rx of reactions) {
            const rt = rx['reactionType'] as string;
            if (rt) rxCounts[rt] = (rxCounts[rt] || 0) + 1;
          }
          const rxStrs = Object.entries(rxCounts).map(([k, v]) => `${k} x${v}`);
          if (rxStrs.length > 0) {
            content += ` [Cảm xúc: ${rxStrs.join(', ')}]`;
          }
        }

        return {
          id,
          senderId,
          senderName: nameMap[senderId] ?? senderId,
          type,
          content,
          createdAt: r['createdAt'] ?? null,
        };
      })
      .filter((x) => x.id && x.senderId);

    return {
      conversationId: String(conversation._id),
      query,
      count: messages.length,
      messages,
    };
  }

  private formatMessagesForContext(input: {
    conversationId: string;
    conversationName?: string;
    messages: Array<{
      senderName: string;
      type?: string;
      content: string;
      createdAt: unknown;
    }>;
  }): string {
    const header = input.conversationName
      ? `[CHAT CONTEXT | Cuộc trò chuyện: "${input.conversationName}" | ID: ${input.conversationId}]`
      : `[CHAT CONTEXT | conversationId: ${input.conversationId}]`;

    const lines = input.messages.map((m) => {
      let time = '';
      if (m.createdAt) {
        const d =
          m.createdAt instanceof Date
            ? m.createdAt
            : new Date(m.createdAt as string);
        if (!isNaN(d.getTime())) {
          // Convert to GMT+7
          const tzOffset = 7 * 60 * 60 * 1000;
          const local = new Date(d.getTime() + tzOffset);
          const hh = String(local.getUTCHours()).padStart(2, '0');
          const mm = String(local.getUTCMinutes()).padStart(2, '0');
          const dd = String(local.getUTCDate()).padStart(2, '0');
          const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
          const yyyy = local.getUTCFullYear();
          time = `[${hh}:${mm} ${dd}/${MM}/${yyyy}] `;
        }
      }
      const name = (m.senderName || 'Unknown').trim();
      const content = (m.content || '').toString().trim();
      const type = (m.type ?? 'TEXT').toUpperCase();

      if (type === 'SYSTEM') {
        // Tin nhắn sự kiện hệ thống: hiển thị dưới dạng chú thích để AI hiểu bối cảnh nhóm
        return `  ${time}[Sự kiện nhóm] ${content}`;
      }
      return `  ${time}${name}: ${content}`;
    });

    return `${header}\nTổng số tin nhắn: ${lines.length}\n${lines.join('\n')}`.trim();
  }

  // ======================== MAIN CHAT METHOD ========================

  async chat(dto: ChatRequestDto): Promise<ChatResponseDto> {
    const {
      userId,
      message,
      fileUrl,
      fileMimeType,
      history = [],
      targetConversationId,
      targetConversationLimit,
    } = dto;
    const files = Array.isArray(dto.files) ? dto.files : [];
    const conversationId = dto.conversationId;

    const convId = conversationId
      ? new Types.ObjectId(conversationId)
      : (
          await this.chatbotConversationModel.create({
            userId: new Types.ObjectId(userId),
            title: 'Cuộc trò chuyện mới',
            lastMessageAt: new Date(),
          })
        )._id;

    // Lưu user message
    const userMsg = await this.chatbotMessageModel.create({
      conversationId: convId,
      userId: new Types.ObjectId(userId),
      role: 'user',
      content: message,
      attachments: (files ?? []).map((f) => ({
        name: f.name ?? 'file',
        url: f.url,
        mimeType: f.mimeType,
      })),
      toolsUsed: [],
    });

    const result = await this.chatWithGroq({
      userId,
      message,
      fileUrl,
      fileMimeType,
      files,
      history,
      chatbotConversationId: convId.toString(),
      targetConversationId,
      targetConversationLimit,
    });

    // Lưu assistant message + update conversation
    await this.chatbotMessageModel.create({
      conversationId: convId,
      userId: new Types.ObjectId(userId),
      role: 'assistant',
      content: result.reply,
      attachments: [],
      toolsUsed: result.toolsUsed ?? [],
    });
    await this.chatbotConversationModel.updateOne(
      { _id: convId, userId: new Types.ObjectId(userId) },
      { $set: { lastMessageAt: new Date() } },
    );

    return {
      ...result,
      conversationId: convId.toString(),
      userMessageId: userMsg._id.toString(),
    };
  }

  // ======================== HELPERS ========================

  private extractStatusCode(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as Record<string, unknown>;

    const status = e['status'];
    if (typeof status === 'number') return status;

    const statusCode = e['statusCode'];
    if (typeof statusCode === 'number') return statusCode;

    const response = e['response'];
    if (response && typeof response === 'object') {
      const r = response as Record<string, unknown>;
      if (typeof r['status'] === 'number') return r['status'];
      if (typeof r['statusCode'] === 'number') return r['statusCode'];
    }

    return undefined;
  }

  private safeErrMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (!err) return '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(err);
    } catch {
      return '';
    }
  }

  private getIsOnlineFromUser(user: Record<string, unknown>): boolean {
    const status = user['status'];
    if (!status || typeof status !== 'object') return false;
    const s = status as Record<string, unknown>;
    return s['isOnline'] === true;
  }

  private getLastSeenFromUser(user: Record<string, unknown>): string | null {
    const status = user['status'];
    if (!status || typeof status !== 'object') return null;
    const s = status as Record<string, unknown>;
    const lastSeen = s['lastSeen'];
    return typeof lastSeen === 'string' ? lastSeen : null;
  }

  private async buildSystemPrompt(userId: string): Promise<string> {
    return await promptStore.render('system.vi', { userId });
  }

  // ======================== GROQ CHAT ========================

  private normalizeJsonSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema))
      return schema.map((s) => this.normalizeJsonSchema(s));
    const obj = schema as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'type' && typeof v === 'string') {
        out[k] = v.toLowerCase();
      } else {
        out[k] = this.normalizeJsonSchema(v);
      }
    }
    return out;
  }

  private asGroqAssistantMessage(value: unknown): {
    content?: unknown;
    tool_calls?: unknown;
  } | null {
    if (!value || typeof value !== 'object') return null;
    return value as { content?: unknown; tool_calls?: unknown };
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 20))}\n...[TRUNCATED]...`;
  }

  private async fetchUrlAsBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }

    // Nếu fileUrl là S3 public URL nhưng bucket private -> GET sẽ 403.
    // Fallback: parse bucket/key rồi tải bằng AWS SDK (cần AWS creds trên backend).
    const status = res.status;
    if (status === 403 || status === 404) {
      const s3Loc = this.tryParseS3Url(url);
      if (s3Loc) {
        this.logger.debug(
          `HTTP ${status} khi tải file, fallback S3 GetObject: s3://${s3Loc.bucket}/${s3Loc.key}`,
        );
        return await this.fetchS3ObjectAsBuffer(s3Loc.bucket, s3Loc.key);
      }
    }

    throw new Error(`HTTP ${res.status} khi tải file từ ${url}`);
  }

  private tryParseS3Url(url: string): { bucket: string; key: string } | null {
    try {
      const u = new URL(url);
      // Pattern: https://{bucket}.s3.{region}.amazonaws.com/{key}
      const host = u.hostname;
      const m = host.match(
        /^([a-z0-9.-]+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
      );
      if (!m) return null;
      const bucket = m[1];
      const key = u.pathname.replace(/^\/+/, '');
      if (!bucket || !key) return null;
      return { bucket, key };
    } catch {
      return null;
    }
  }

  private async fetchS3ObjectAsBuffer(
    bucket: string,
    key: string,
  ): Promise<Buffer> {
    const out = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    const body = out.Body;
    if (!body) throw new Error('S3 object Body is empty');

    // AWS SDK v3: Body can be ReadableStream/Readable
    if (Buffer.isBuffer(body)) return body;

    const chunks: Buffer[] = [];
    const stream = body as AsyncIterable<unknown>;
    for await (const chunk of stream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(String(chunk)));
      }
    }
    return Buffer.concat(chunks);
  }

  private async extractFileTextForGroq(file: {
    url: string;
    mimeType?: string;
    name?: string;
  }): Promise<string> {
    const mime = (file.mimeType ?? '').toLowerCase();
    const name = (file.name ?? '').toLowerCase();

    // Text-like
    if (
      mime.startsWith('text/') ||
      mime.includes('application/json') ||
      mime.includes('application/csv')
    ) {
      const buf = await this.fetchUrlAsBuffer(file.url);
      const txt = buf.toString('utf-8');
      return this.truncateText(txt, 12000);
    }

    // PDF
    if (mime.includes('pdf')) {
      const buf = await this.fetchUrlAsBuffer(file.url);
      const parser = new PDFParse({ data: buf });
      const textResult = await parser.getText();
      await parser.destroy();
      const txt = (textResult.text ?? '').trim();
      return this.truncateText(txt, 12000);
    }

    // DOCX (Word)
    if (
      mime.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) ||
      name.endsWith('.docx')
    ) {
      const buf = await this.fetchUrlAsBuffer(file.url);
      const result = await mammoth.extractRawText({ buffer: buf });
      const txt = (result.value ?? '').trim();
      return this.truncateText(txt, 12000);
    }

    // Images / unknown binaries: cannot extract text reliably here
    return '';
  }

  private async buildGroqFilesContext(
    files: Array<{
      url: string;
      mimeType?: string;
      name?: string;
    }>,
  ): Promise<string> {
    if (files.length === 0) return '';

    const blocks: string[] = [];
    for (const f of files.slice(0, 3)) {
      try {
        const text = await this.extractFileTextForGroq(f);
        if (!text) {
          blocks.push(
            `[FILE: ${f.name ?? 'unknown'} | ${f.mimeType ?? 'unknown'}]\n(Không trích xuất được nội dung text từ file này. Nếu là ảnh, hãy mô tả nội dung hoặc gửi bản text/PDF có selectable text.)`,
          );
          continue;
        }
        blocks.push(
          `[FILE: ${f.name ?? 'unknown'} | ${f.mimeType ?? 'unknown'}]\n${text}`,
        );
      } catch (e: unknown) {
        this.logger.warn(
          `Lỗi khi tải/đọc file '${f.name ?? 'unknown'}' (${f.mimeType ?? 'unknown'}) từ ${f.url}: ${this.safeErrMessage(e)}`,
        );
        blocks.push(
          `[FILE: ${f.name ?? 'unknown'}]\n(Lỗi khi tải/đọc file: ${this.safeErrMessage(e)})`,
        );
      }
    }

    return `\n\n[NỘI DUNG FILE ĐÍNH KÈM]\n${blocks.join('\n\n')}`;
  }

  private async chatWithGroq(params: {
    userId: string;
    message: string;
    fileUrl?: string;
    fileMimeType?: string;
    files?: { url: string; mimeType: string; name?: string }[];
    history: { role: string; content: string }[];
    chatbotConversationId?: string;
    targetConversationId?: string;
    targetConversationLimit?: number;
  }): Promise<ChatResponseDto> {
    if (!this.hasGroqKey || !this.groq) {
      return {
        reply:
          'Chatbot chưa được cấu hình Groq API key (thiếu `GROQ_API_KEY`). Vui lòng cấu hình lại server.',
        toolsUsed: [],
      };
    }

    const {
      userId,
      message,
      fileUrl,
      fileMimeType,
      files,
      history,
      chatbotConversationId,
      targetConversationId,
      targetConversationLimit,
    } = params;

    const models = process.env.GROQ_MODELS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

    const system = await this.buildSystemPrompt(userId);

    const toolsUsed: string[] = [];

    // Groq chat.completions: OpenAI-compatible messages/tools
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
    ];

    for (const h of history ?? []) {
      const role =
        h.role === 'assistant' || h.role === 'model'
          ? 'assistant'
          : h.role === 'system'
            ? 'system'
            : 'user';
      messages.push({
        role,
        content: h.content ?? '',
      } as ChatCompletionMessageParam);
    }

    const rawUserMessage = message ?? '';
    let userContent = rawUserMessage;
    const normalizedUserMessage = this.normalizeForIntent(rawUserMessage);

    const incomingFiles = Array.isArray(files) ? files : fileUrl ? [{ url: fileUrl, mimeType: fileMimeType }] : [];
    const asksAboutFile = this.hasAnyPhrase(normalizedUserMessage, [
      'file',
      'tai lieu',
      'van ban',
      'tai ve',
      'dinh kem',
      'dinh kem file',
      'file dinh kem',
      'tep',
      'tap tin',
      'docx',
      'pdf',
      'doc',
      'noi ve gi',
      'noi dung gi',
      'noi dung file',
      'noi dung tai lieu',
      'tom tat file',
      'tom tat tai lieu',
      'giai thich file',
      'giai thich tai lieu',
      'file nay',
      'tai lieu nay',
      'tep nay',
    ]);
    const hasDeliveryFile = incomingFiles.some((f) =>
      (f.name ?? '').toLowerCase().includes('delivery'),
    );

    if (this.isSensitiveInfoQuery(normalizedUserMessage)) {
      return {
        reply:
          'Mình không thể hỗ trợ các thông tin nhạy cảm như mật khẩu, OTP, PIN, token. Bạn vui lòng tự kiểm tra trong phần cài đặt bảo mật nhé.',
        toolsUsed: [],
      };
    }

    const chatIntentPhrases = [
      'chat',
      'nhom',
      'group',
      'doan chat',
      'cuoc tro chuyen',
      'tin nhan',
      'tom tat',
      'summary',
      'trich',
      'trong nhom',
      'trong group',
      'o nhom',
      'nhan gi',
      'nhan tin',
      'noi gi',
      'voi ai',
      '1 1',
      'hoi thoai',
      'tro chuyen',
      'noi chuyen',
      'noi dung chat',
      'noi dung tin nhan',
      'lich su chat',
      'lich su nhan tin',
      'nhan voi',
      'chat voi',
      'dang noi gi',
      'ban luan gi',
      'noi gi trong',
      'nhan gi trong',
      'co tin nhan',
      'tin nhan gan nhat',
      'tin nhan moi nhat',
      'doc tin',
      'nhung tin nhan',
      'cuoc chat',
      'nhan cho',
    ];

    const dbIntentPhrases = [
      'ban be',
      'bao nhieu ban',
      'so ban',
      'danh sach ban',
      'ket ban',
      'loi moi ket ban',
      'pending',
      'online',
      'last seen',
      'trang thai',
      'tim ban',
      'tim nguoi',
      'user info',
      'thong tin user',
      'thong tin nguoi dung',
      'thong tin tai khoan',
      'ho so',
      'profile',
      'ho ten',
      'ten la gi',
      'ten gi',
      'ten day du',
      'full name',
      'so dien thoai',
      'dien thoai',
      'so dt',
      'sdt',
      'phone',
      'email',
      'avatar',
      'username',
      'id user',
      'uid',
      'bio',
      'ai la ban',
      'ban toi la ai',
      'co ai la ban',
      'nhung ai la ban',
      'co nhung ban nao',
      'nhung nguoi ban',
      'danh sach friends',
      'nguoi dung',
      'tai khoan',
      'loi moi',
      'request',
      'chua duyet',
      'chua chap nhan',
      'chap nhan',
      'dong y',
      'ban be moi',
      'moi ket ban',
      'hinh dai dien',
      'anh dai dien',
      'anh bia',
      'tieu su',
      'chi tiet user',
      'dang hoat dong',
      'hoat dong gan nhat',
      'co truc tuyen',
      'so dt cua',
      'sdt cua',
      'email cua',
    ];

    const deliveryIntentPhrases = [
      'delivery',
      'giao hang',
      'don hang',
      'ship',
      'van chuyen',
      'shipper',
      'giao cho',
      'gui hang',
      'chuyen phat',
      'don so',
      'ma don hang',
      'ma van don',
      'tinh trang don hang',
      'trang thai don hang',
      'tracking',
      'giao do',
      'nhan hang',
      'gui do',
      'chuyen hang',
    ];

    const chatHits = this.countMatchedPhrases(
      normalizedUserMessage,
      chatIntentPhrases,
    );
    const dbHits = this.countMatchedPhrases(normalizedUserMessage, dbIntentPhrases);
    const deliveryHits = this.countMatchedPhrases(
      normalizedUserMessage,
      deliveryIntentPhrases,
    );

    let chatScore = chatHits * 3;
    let dbScore =
      dbHits * 3 + (this.isPersonalFieldQuery(normalizedUserMessage) ? 3 : 0);
    let deliveryScore = deliveryHits * 3;

    if (targetConversationId && targetConversationId.trim().length > 0) {
      // Có targetConversationId chỉ là tín hiệu nhẹ, không override intent DB rõ ràng.
      chatScore += 1;
    }

    let wantsChatContext = chatScore >= 3;
    let wantsDbTools = dbScore >= 3;
    let wantsDelivery = deliveryScore >= 3;

    if (!wantsDelivery && incomingFiles.length > 0 && asksAboutFile && hasDeliveryFile) {
      wantsDelivery = true;
      deliveryScore = Math.max(deliveryScore, 3);
    }

    const hasExplicitChatSignal = this.hasAnyPhrase(normalizedUserMessage, [
      'tin nhan',
      'chat',
      'tom tat',
      'noi gi',
      'nhan gi',
      'trong nhom',
      '1 1',
    ]);

    // Nếu DB intent mạnh hơn rõ rệt thì tắt chat context để tránh lẫn dữ liệu chat cũ.
    if (wantsDbTools && !hasExplicitChatSignal && dbScore >= chatScore + 2) {
      wantsChatContext = false;
    }

    const isDbFollowUp = this.isDbFollowUpQuery(normalizedUserMessage);
    const recentIntent = await this.inferRecentIntentFromConversation({
      conversationId: chatbotConversationId,
      userId,
    });

    // Câu hỏi nối tiếp ngắn kiểu "tên là gì", "email là gì" sau lượt DB trước đó
    // cần được giữ cùng intent DB thay vì bị từ chối ngoài phạm vi.
    if (!wantsDbTools && !wantsChatContext && !wantsDelivery && isDbFollowUp) {
      if (recentIntent === 'db') {
        wantsDbTools = true;
        dbScore = Math.max(dbScore, 3);
      }
    }

    // Nếu câu follow-up mơ hồ nhưng có ngữ cảnh DB rõ ràng từ lượt trước,
    // ưu tiên DB thay vì delivery/chat.
    if (isDbFollowUp && recentIntent === 'db' && !hasExplicitChatSignal) {
      wantsDbTools = true;
      wantsChatContext = false;
      wantsDelivery = false;
      deliveryScore = 0;
    }

    const forceLookupName = this.extractLookupNameFromDbQuery(normalizedUserMessage);
    const forceLookupByName =
      wantsDbTools && this.isPersonalFieldQuery(normalizedUserMessage) && Boolean(forceLookupName);

    this.logger.debug(
      `[intent-score] chat=${chatScore} db=${dbScore} delivery=${deliveryScore} recent=${recentIntent} followUpDb=${isDbFollowUp} => wantsChat=${wantsChatContext} wantsDb=${wantsDbTools} wantsDelivery=${wantsDelivery} forceLookupByName=${forceLookupByName} name='${forceLookupName}'`,
    );

    if (!wantsDelivery && incomingFiles.length > 0 && asksAboutFile) {
      return {
        reply:
          'Mình chỉ hỗ trợ đọc/giải thích file khi nội dung liên quan delivery (giao hàng). File bạn gửi chưa thể xác định là delivery, bạn vui lòng gửi đúng tài liệu giao hàng hoặc hỏi theo nhóm khác nhé.',
        toolsUsed: [],
      };
    }

    // Enforce scope on server: ngoài (A)/(B)/(C) thì từ chối, không gọi LLM.
    if (!wantsChatContext && !wantsDbTools && !wantsDelivery) {
      return {
        reply:
          'Mình chỉ hỗ trợ 3 nhóm: (1) tra cứu dữ liệu trong app (bạn bè, lời mời kết bạn, thông tin user...), (2) delivery (giao hàng), (3) tóm tắt/hỏi đáp theo nội dung chat nhóm/1-1. Câu hỏi này nằm ngoài phạm vi nên mình chưa thể hỗ trợ. Bạn muốn hỏi theo nhóm nào?',
        toolsUsed: [],
      };
    }

    // Với intent DB thuần, ưu tiên xử lý trực tiếp ở backend để đảm bảo câu trả lời cụ thể,
    // tránh model gọi tool sai hoặc trả lời vòng vo.
    if (wantsDbTools && !wantsChatContext && !wantsDelivery) {
      const directDb = await this.tryDirectDbResponse({
        userId,
        normalizedUserMessage,
        isDbFollowUp,
        recentIntent,
        forceLookupName,
      });
      if (directDb) {
        this.logger.log('✅ Direct DB response đã được áp dụng');
        return directDb;
      }
    }

    // Với intent Chat thuần, cũng ưu tiên xử lý trực tiếp
    if (wantsChatContext && !wantsDbTools && !wantsDelivery) {
      const directChat = await this.tryDirectChatResponse({
        userId,
        normalizedUserMessage,
        chatbotConversationId,
        targetConversationId,
        recentIntent,
      });
      if (directChat) {
        this.logger.log('✅ Direct Chat response đã được áp dụng');
        return directChat;
      }
    }

    const normalizedFiles: Array<{
      url: string;
      mimeType?: string;
      name?: string;
    }> = incomingFiles;

    // Rule: chỉ hỗ trợ "đọc/giải thích nội dung" PDF nếu liên quan "delivery".
    // Nếu không liên quan delivery thì AI vẫn trả lời, nhưng phải từ chối xử lý file đó.
    const msgLower = (message ?? '').toLowerCase();
    const fileInfos: string[] = [];
    const supportedFiles: Array<{
      url: string;
      mimeType?: string;
      name?: string;
    }> = [];
    for (const f of normalizedFiles) {
      const mime = (f.mimeType ?? '').toLowerCase();
      const nameLower = (f.name ?? '').toLowerCase();
      const isPdf = mime.includes('pdf') || nameLower.endsWith('.pdf');
      const isDocx =
        mime.includes(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ) || nameLower.endsWith('.docx');
      const isDoc =
        mime.includes('application/msword') || nameLower.endsWith('.doc');
      const isDelivery =
        wantsDelivery || msgLower.includes('delivery') || nameLower.includes('delivery');

      fileInfos.push(
        `- ${f.name ? `${f.name} ` : ''}(url=${f.url}${f.mimeType ? ` mime=${f.mimeType}` : ''})`,
      );

      if ((isPdf || isDocx || isDoc) && !isDelivery) {
        // Bỏ qua file này (không đưa vào phần "đọc file")
        continue;
      }

      supportedFiles.push(f);
    }

    if (fileInfos.length > 0) {
      userContent += `\n\n[File đính kèm]\n${fileInfos.join('\n')}`;
      if (supportedFiles.length !== normalizedFiles.length) {
        userContent +=
          '\n\n[Lưu ý]\nCó file PDF không liên quan "delivery". Hãy từ chối đọc/giải thích nội dung các file đó và hướng dẫn người dùng gửi tài liệu delivery phù hợp.';
      }
    }

    // Nạp nội dung file (text/pdf) để Groq thật sự "đọc" được
    if (supportedFiles.length > 0) {
      userContent += await this.buildGroqFilesContext(supportedFiles);
    }

    // Nếu thuộc delivery nhưng không thuộc chat/db, vẫn không nên gọi tools.
    if (wantsDelivery && !wantsChatContext && !wantsDbTools) {
      messages.push({
        role: 'system',
        content:
          'Câu hỏi thuộc phạm vi delivery. Không suy đoán dữ liệu trong app và không gọi tools trừ khi người dùng yêu cầu rõ ràng về dữ liệu/chat.',
      });
    }

    if (wantsDbTools) {
      messages.push({
        role: 'system',
        content:
          'Người dùng đang hỏi DỮ LIỆU TRONG APP. Hãy ưu tiên dùng các DB tools. ' +
          'Nếu hỏi thông tin 1 người theo tên (ví dụ: số điện thoại của Wind), gọi searchUserByName trước để lấy userId, sau đó gọi getUserInfo để lấy phone/email/avatar/online/lastSeen. ' +
          'Không suy diễn từ nội dung chat trước đó và không trộn dữ liệu chat vào câu trả lời dữ liệu app.',
      });

      if (isDbFollowUp && recentIntent === 'db') {
        messages.push({
          role: 'system',
          content:
            'Đây là câu hỏi nối tiếp từ lượt tra cứu dữ liệu app trước đó. Nếu user hỏi ngắn kiểu "tên là gì" thì hiểu là hỏi tiếp về danh sách bạn/user vừa được nhắc tới. Ưu tiên gọi getFriendList hoặc getUserInfo phù hợp để trả lời trực tiếp.',
        });
      }
    }

    // Nạp ngữ cảnh từ cuộc trò chuyện chat thật (nhóm/1-1) để AI tóm tắt / hỏi đáp.
    if (
      wantsChatContext &&
      targetConversationId &&
      targetConversationId.trim().length > 0
    ) {
      try {
        // Giảm limit mặc định xuống 40, tối đa 60 để tránh lỗi 413 Request Too Large
        const limit = Math.min(Math.max(targetConversationLimit ?? 40, 1), 60);
        const raw = (await this.getChatMessagesForAi({
          userId,
          conversationId: targetConversationId,
          limit,
        })) as {
          conversationId: string;
          conversationName?: string;
          count: number;
          messages: any[];
        };
        const ctx = this.formatMessagesForContext({
          conversationId: raw.conversationId,
          conversationName: raw.conversationName,
          messages: (raw.messages ?? []).map((m: unknown) => {
            const r = this.asRecord(m);
            return {
              senderName: this.asSafeString(r['senderName']),
              type: this.asSafeString(r['type'] ?? 'TEXT'),
              content: this.asSafeString(r['content']),
              createdAt: r['createdAt'],
            };
          }),
        });
        userContent += `\n\n${ctx}`;
        this.logger.debug(
          `Đã nạp ${raw.count} tin nhắn vào context cho conversation "${raw.conversationName ?? targetConversationId}"`,
        );
      } catch (e: unknown) {
        userContent += `\n\n[CHAT CONTEXT ERROR]\nKhông thể tải nội dung cuộc trò chuyện (không có quyền hoặc conversationId không hợp lệ).`;
        this.logger.warn(
          `Không thể nạp chat context cho conversationId=${targetConversationId}: ${this.safeErrMessage(e)}`,
        );
      }
    }
    messages.push({ role: 'user', content: userContent });

    const tools: ChatCompletionTool[] = (this.toolDeclarations ?? []).map(
      (d: unknown) => {
        const decl = d as Record<string, unknown>;
        const name = decl['name'] as string;
        const description = (decl['description'] as string) ?? '';
        const parameters = this.normalizeJsonSchema(decl['parameters']);
        return {
          type: 'function',
          function: {
            name,
            description,
            parameters: parameters as Record<string, unknown>,
          },
        };
      },
    );

    const enableTools = wantsChatContext || wantsDbTools;

    // Chỉ bật đúng nhóm tools theo intent để tránh model gọi nhầm tool (vd: searchUserByName)
    // khi user đang hỏi về nội dung chat.
    const chatToolNames = new Set(['getChatMessages', 'searchChatMessages']);
    const dbToolNames = new Set([
      'getFriendCount',
      'getFriendList',
      'getRecentFriends',
      'getPendingFriendRequests',
      'getUserInfo',
      'searchUserByName',
    ]);

    const toolsForRequest = enableTools
      ? tools.filter((t) => {
          const name = (t as { function?: { name?: string } })?.function?.name;
          if (!name) return false;
          if (wantsChatContext && !wantsDbTools) return chatToolNames.has(name);
          if (wantsDbTools && !wantsChatContext) return dbToolNames.has(name);
          return chatToolNames.has(name) || dbToolNames.has(name);
        })
      : [];

    let lastChatMessages: {
      conversationId: string;
      count: number;
      messages: unknown[];
    } | null = null;

    // Thêm system hint một lần trước khi vào vòng lặp model/turn
    if (wantsChatContext && !wantsDbTools) {
      messages.push({
        role: 'system',
        content:
          'Người dùng đang hỏi về NỘI DUNG CHAT cụ thể. ' +
          'Nếu request có sẵn [CHAT CONTEXT], hãy đọc toàn bộ và trả lời trực tiếp dựa trên nội dung đó. ' +
          'Nếu chưa có context, gọi tool getChatMessages/searchChatMessages để lấy. ' +
          'Tin nhắn loại [Sự kiện nhóm] là thông báo hệ thống (thêm/bớt thành viên, đổi tên...) — dùng làm bối cảnh, KHÔNG phải lời nói của người dùng. ' +
          'ĐẶC BIỆT LƯU Ý: Phải liệt kê hoặc tóm tắt các tin nhắn theo ĐÚNG THỨ TỰ THỜI GIAN. KHÔNG gộp chung các tin nhắn của cùng một người thành một dòng. ' +
          'Trả lời bằng lời văn tự nhiên, tiếng Việt, cụ thể và có trích dẫn nếu cần. ' +
          'KHÔNG gọi các tool về bạn bè/user khi đang phân tích nội dung chat.',
      });
    }

    for (const model of models) {
      try {
        this.logger.debug(`Thử Groq model: ${model}`);
        for (let turn = 0; turn < 5; turn++) {

          const completion = await this.groq.chat.completions.create({
            model,
            messages,
            tools: toolsForRequest,
            tool_choice: enableTools ? 'auto' : 'none',
            temperature: 0.7,
            max_completion_tokens: 1024,
            top_p: 1,
            stream: false,
          });

          const rawMsg = completion.choices?.[0]?.message as unknown;
          const msg = this.asGroqAssistantMessage(rawMsg);

          const content =
            msg && typeof msg.content === 'string' ? msg.content : '';
          const toolCalls: ChatCompletionMessageToolCall[] = Array.isArray(
            msg?.tool_calls,
          )
            ? (msg.tool_calls as ChatCompletionMessageToolCall[])
            : [];

          messages.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls,
          } as unknown as ChatCompletionMessageParam);

          if (!toolCalls || toolCalls.length === 0) {
            const pseudoResolved = await this.resolvePseudoFunctionTagsInText({
              text: content,
              currentUserId: userId,
              targetConversationId,
              normalizedUserMessage,
              forceLookupName,
              forceLookupByName,
            });

            if (pseudoResolved.hadTags) {
              for (const t of pseudoResolved.usedTools) {
                if (!toolsUsed.includes(t)) toolsUsed.push(t);
              }
              if (pseudoResolved.text.length > 0) {
                this.logger.log(
                  `✅ Đã resolve pseudo function tags trong phản hồi model: ${pseudoResolved.usedTools.join(', ')}`,
                );
                return { reply: pseudoResolved.text, toolsUsed };
              }
            }

            if (wantsDbTools && forceLookupByName && toolsUsed.length === 0) {
              const forced = await this.forceReplyForPersonalFieldQuery({
                currentUserId: userId,
                normalizedUserMessage,
              });
              if (forced) {
                this.logger.log(
                  `✅ Forced DB fallback thành công cho personal-field query: ${forceLookupName}`,
                );
                return forced;
              }
            }

            if (wantsDbTools && isDbFollowUp && recentIntent === 'db' && toolsUsed.length === 0) {
              const forcedFollowUp = await this.forceReplyForAmbiguousDbFollowUp(
                {
                  currentUserId: userId,
                  normalizedUserMessage,
                },
              );
              if (forcedFollowUp) {
                this.logger.log('✅ Forced DB follow-up fallback thành công');
                return forcedFollowUp;
              }
            }

            const text = content.trim();
            if (text.length === 0) {
              return {
                reply: 'Xin lỗi, tôi không thể xử lý yêu cầu này lúc này. Bạn thử hỏi lại nhé.',
                toolsUsed,
              };
            }
            this.logger.log(`✅ Groq model hoạt động: ${model}`);
            return { reply: text, toolsUsed };
          }

          for (const tc of toolCalls) {
            const fnName = tc.function?.name;
            const toolCallId = tc.id;
            const rawArgs = tc.function?.arguments ?? '{}';

            if (!fnName || !toolCallId) continue;
            toolsUsed.push(fnName);

            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(rawArgs) as Record<string, unknown>;
            } catch {
              args = {};
            }

            let toolResult: unknown;
            try {
              toolResult = await this.executeTool(fnName, args, {
                currentUserId: userId,
                lockedConversationId: targetConversationId,
                normalizedUserMessage,
                forceLookupName,
                forceLookupByName,
              });
            } catch (err: unknown) {
              this.logger.warn(
                `Lỗi khi chạy tool ${fnName}: ${this.safeErrMessage(err)}`,
              );
              toolResult = { error: this.safeErrMessage(err) };
            }
            if (fnName === 'getChatMessages') {
              const r = this.asRecord(toolResult);
              const msgs = r['messages'];
              const cid = r['conversationId'];
              if (Array.isArray(msgs) && typeof cid === 'string') {
                const c = r['count'];
                lastChatMessages = {
                  conversationId: cid,
                  count: typeof c === 'number' ? c : msgs.length,
                  messages: msgs,
                };
              }
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({ result: toolResult }),
            });
          }
        }

        this.logger.log(`✅ Groq model hoạt động: ${model}`);
        return {
          reply:
            'Mình đã xử lý yêu cầu nhưng chưa thể tạo câu trả lời cuối. Bạn thử hỏi lại ngắn gọn hơn nhé.',
          toolsUsed,
        };
      } catch (err: any) {
        const status = this.extractStatusCode(err);
        const msg = this.safeErrMessage(err);
        const is404 =
          status === 404 ||
          msg.includes('404') ||
          msg.toLowerCase().includes('not found');
        if (is404) {
          this.logger.warn(
            `Groq model ${model} không tồn tại (404). Thử model tiếp...`,
          );
          continue;
        }
        const isAuth = status === 401 || status === 403;
        if (isAuth) {
          return {
            reply:
              'Không thể gọi Groq: API key không hợp lệ hoặc không có quyền (401/403). Vui lòng kiểm tra `GROQ_API_KEY`.',
            toolsUsed,
          };
        }
        const isRate = status === 429;
        if (isRate) {
          this.logger.warn(
            `Groq rate limit (429) với model ${model}. Thử model tiếp...`,
          );
          continue;
        }
        const isTooLarge = status === 413;
        if (isTooLarge) {
          return {
            reply:
              'Nội dung tin nhắn cần xử lý quá dài, vượt quá khả năng của AI. Bạn vui lòng giới hạn lại số lượng (ví dụ: "10 tin nhắn gần nhất") hoặc tìm kiếm theo từ khoá cụ thể nhé.',
            toolsUsed,
          };
        }
        this.logger.warn(`Lỗi Groq khi thử model ${model}: ${msg}`);
        throw err;
      }
    }

    return {
      reply:
        'Không có model Groq nào khả dụng. Vui lòng kiểm tra lại API key hoặc thử lại sau.',
      toolsUsed: [],
    };
  }
}

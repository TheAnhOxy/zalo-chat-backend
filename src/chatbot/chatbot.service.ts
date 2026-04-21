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
  ChatbotConversation,
  ChatbotConversationDocument,
} from './schemas/chatbot-conversation.schema';
import {
  ChatbotMessage,
  ChatbotMessageDocument,
} from './schemas/chatbot-message.schema';

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
        },
        required: ['userId'],
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
          limit: {
            type: 'NUMBER',
            description: 'Số lượng tối đa, mặc định 10',
          },
        },
        required: ['userId'],
      },
    },
    {
      name: 'getRecentFriends',
      description: 'Lấy danh sách bạn bè mới kết bạn gần đây nhất',
      parameters: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: 'MongoDB ObjectId của user' },
          limit: {
            type: 'NUMBER',
            description: 'Số lượng kết quả, mặc định 5',
          },
        },
        required: ['userId'],
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
        },
        required: ['userId'],
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
        },
        required: ['userId'],
      },
    },
    {
      name: 'searchUserByName',
      description: 'Tìm kiếm user theo tên (fullName) trong danh sách bạn bè',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Tên cần tìm kiếm' },
          currentUserId: {
            type: 'STRING',
            description: 'MongoDB ObjectId của user hiện tại',
          },
        },
        required: ['name', 'currentUserId'],
      },
    },
  ];

  // ======================== TOOL EXECUTION ========================

  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.logger.debug(`Executing tool: ${toolName}`, args);

    switch (toolName) {
      case 'getFriendCount': {
        const userId = args.userId as string;
        const friendships = await this.friendshipsService.findByUserId(userId);
        const accepted = friendships.filter(
          (f) => f['status'] === FriendshipStatus.ACCEPTED,
        );
        return {
          count: accepted.length,
          message: `User có ${accepted.length} bạn bè`,
        };
      }

      case 'getFriendList': {
        const userId = args.userId as string;
        const limit = (args.limit as number) ?? 10;
        const friendships = await this.friendshipsService.findByUserId(userId);
        const accepted = friendships
          .filter((f) => f['status'] === FriendshipStatus.ACCEPTED)
          .slice(0, limit);

        // Lấy thông tin tên của từng bạn
        const friendDetails = await Promise.all(
          accepted.map(async (f) => {
            const friendId: string =
              f['requesterId']?.toString() === userId
                ? (f['addresseeId']?.toString() ?? '')
                : (f['requesterId']?.toString() ?? '');
            if (!friendId)
              return { userId: '', fullName: 'Unknown', avatar: '' };
            try {
              const user = (await this.usersService.findById(
                friendId,
              )) as unknown as Record<string, unknown>;
              return {
                userId: friendId,
                fullName: user['fullName'],
                avatar: user['avatar'],
                isOnline: this.getIsOnlineFromUser(user),
              };
            } catch {
              return { userId: friendId, fullName: 'Unknown', avatar: '' };
            }
          }),
        );

        return { friends: friendDetails, total: friendDetails.length };
      }

      case 'getRecentFriends': {
        const userId = args.userId as string;
        const limit = (args.limit as number) ?? 5;
        const friendships = await this.friendshipsService.findByUserId(userId);
        const recentAccepted = friendships
          .filter((f) => f['status'] === FriendshipStatus.ACCEPTED)
          .sort(
            (a, b) =>
              new Date(b['updatedAt'] as string).getTime() -
              new Date(a['updatedAt'] as string).getTime(),
          )
          .slice(0, limit);

        const friendDetails = await Promise.all(
          recentAccepted.map(async (f) => {
            const friendId: string =
              f['requesterId']?.toString() === userId
                ? (f['addresseeId']?.toString() ?? '')
                : (f['requesterId']?.toString() ?? '');
            if (!friendId) return { userId: '', fullName: 'Unknown' };
            try {
              const user = await this.usersService.findById(friendId);
              return {
                userId: friendId,
                fullName: user['fullName'],
                avatar: user['avatar'],
                keptFriendsAt: f['updatedAt'],
              };
            } catch {
              return { userId: friendId, fullName: 'Unknown' };
            }
          }),
        );

        return { recentFriends: friendDetails };
      }

      case 'getPendingFriendRequests': {
        const userId = args.userId as string;
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
        const userId = args.userId as string;
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
        const friendships =
          await this.friendshipsService.findByUserId(currentUserId);
        const acceptedFriendIds = friendships
          .filter((f) => f['status'] === FriendshipStatus.ACCEPTED)
          .map((f) =>
            f['requesterId']?.toString() === currentUserId
              ? f['addresseeId']?.toString()
              : f['requesterId']?.toString(),
          );

        const results = await Promise.all(
          acceptedFriendIds.map(async (fid) => {
            if (!fid) return null;
            try {
              const user = (await this.usersService.findById(
                fid,
              )) as unknown as Record<string, unknown>;
              const fullName = (user['fullName'] as string) || '';
              if (fullName.toLowerCase().includes(name.toLowerCase())) {
                return {
                  userId: fid,
                  fullName,
                  avatar: user['avatar'],
                  isOnline: this.getIsOnlineFromUser(user),
                };
              }
            } catch {
              // ignore
            }
            return null;
          }),
        );

        const found = results.filter(Boolean);
        return { results: found, count: found.length };
      }

      default:
        return { error: `Tool '${toolName}' không được hỗ trợ` };
    }
  }

  // ======================== MAIN CHAT METHOD ========================

  async chat(dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { userId, message, fileUrl, fileMimeType, history = [] } = dto;
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

  private buildSystemPrompt(userId: string): string {
    return `Bạn là trợ lý AI của ứng dụng QuickChat.

Bạn CHỈ được phép hỗ trợ 2 nhóm nội dung sau (ngoài phạm vi thì phải từ chối lịch sự):

1) **Câu hỏi liên quan đến cơ sở dữ liệu của ứng dụng** (userId hiện tại: ${userId}):
   - Ví dụ: bạn bè, danh sách bạn bè, số lượng bạn bè, lời mời kết bạn đang chờ, thông tin user, trạng thái online, tìm bạn theo tên.
   - Khi cần dữ liệu thật, BẮT BUỘC gọi tools để truy vấn database.
   - KHÔNG bịa số liệu, KHÔNG suy đoán dữ liệu.

2) **Câu hỏi về delivery (giao hàng)**:
   - Có thể trả lời dựa trên kiến thức/logic chung của ứng dụng.
   - Nếu user gửi kèm file (PDF/ảnh/văn bản), hãy ưu tiên đọc và trả lời bám sát nội dung file; nếu thiếu thông tin trong file thì nói rõ.

Nếu user hỏi ngoài 2 nhóm trên (ví dụ: tán gẫu, hỏi kiến thức chung), hãy trả lời thân thiện và điều hướng lại đúng phạm vi.
Đặc biệt: nếu user chỉ chào hỏi (ví dụ "hello", "xin chào"), hãy chào lại và gợi ý các câu hỏi phù hợp.

Mẫu trả lời gợi ý (bạn có thể diễn đạt tự nhiên):
- "Chào bạn. Mình là trợ lý AI của QuickChat. Bạn muốn hỏi về **delivery** hay cần mình tra cứu **dữ liệu trong app** (bạn bè, lời mời kết bạn, thông tin user...)?"

Quy tắc:
- Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.
- Không tiết lộ thông tin nhạy cảm (password, token, API key...).`;
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
  }): Promise<ChatResponseDto> {
    if (!this.hasGroqKey || !this.groq) {
      return {
        reply:
          'Chatbot chưa được cấu hình Groq API key (thiếu `GROQ_API_KEY`). Vui lòng cấu hình lại server.',
        toolsUsed: [],
      };
    }

    const { userId, message, fileUrl, fileMimeType, files, history } = params;

    const models = process.env.GROQ_MODELS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

    const system = this.buildSystemPrompt(userId);

    const toolsUsed: string[] = [];

    // Groq chat.completions: OpenAI-compatible messages/tools
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
    ];

    for (const h of history ?? []) {
      const role =
        h.role === 'assistant'
          ? 'assistant'
          : h.role === 'system'
            ? 'system'
            : 'user';
      messages.push({
        role,
        content: h.content ?? '',
      } as ChatCompletionMessageParam);
    }

    let userContent = message ?? '';
    const normalizedFiles: Array<{
      url: string;
      mimeType?: string;
      name?: string;
    }> =
      files && files.length > 0
        ? files
        : fileUrl
          ? [{ url: fileUrl, mimeType: fileMimeType }]
          : [];

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
      const isDoc = mime.includes('application/msword') || nameLower.endsWith('.doc');
      const isDelivery =
        msgLower.includes('delivery') || nameLower.includes('delivery');

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

    for (const model of models) {
      try {
        this.logger.debug(`Thử Groq model: ${model}`);
        for (let turn = 0; turn < 5; turn++) {
          const completion = await this.groq.chat.completions.create({
            model,
            messages,
            tools,
            tool_choice: 'auto',
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
            const text = content.trim();
            if (text.length === 0) {
              return {
                reply: 'Xin lỗi, tôi không thể xử lý yêu cầu này.',
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

            const toolResult = await this.executeTool(fnName, args);
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

import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserGender } from '../users/schemas/user.schema';
import {
  Session,
  SessionDocument,
  SessionDevice,
} from '../sessions/schemas/session.schema';
import {
  Friendship,
  FriendshipDocument,
  FriendshipStatus,
} from '../friendships/schemas/friendship.schema';
import {
  Conversation,
  ConversationDocument,
  ConversationType,
  ConversationMemberRole,
} from '../conversations/schemas/conversation.schema';
import {
  Message,
  MessageDocument,
  MessageType,
  MessageStatus,
  ReactionType,
} from '../messages/schemas/message.schema';
import {
  Call,
  CallDocument,
  CallType,
  CallStatus,
} from '../calls/schemas/call.schema';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import {
  Story,
  StoryDocument,
  StoryMediaType,
} from '../stories/schemas/story.schema';
import {
  Report,
  ReportDocument,
  ReportStatus,
} from '../reports/schemas/report.schema';

@Injectable()
export class SeedService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Call.name) private callModel: Model<CallDocument>,
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectModel(Story.name) private storyModel: Model<StoryDocument>,
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
  ) {}

  async run(): Promise<void> {
    console.log('🌱 Bắt đầu seed (zalo-chat-backend)...');
    await this.clearAll();

    const hash = await bcrypt.hash('123456', 10);

    const u1 = await this.userModel.create({
      phone: '0901000001',
      email: 'user1@zalo-chat.test',
      password: hash,
      fullName: 'Nguyễn Văn A',
      avatar: 'https://i.pravatar.cc/150?u=1',
      coverImage: 'https://picsum.photos/seed/cover1/800/200',
      dob: new Date('1998-05-15'),
      gender: UserGender.MALE,
      bio: 'Xin chào, mình là A.',
      status: { isOnline: true, lastSeen: new Date() },
      fcmTokens: ['fcm-demo-user1'],
      isVerified: true,
      isBlocked: false,
    });

    const u2 = await this.userModel.create({
      phone: '0901000002',
      email: 'user2@zalo-chat.test',
      password: hash,
      fullName: 'Trần Thị B',
      avatar: 'https://i.pravatar.cc/150?u=2',
      gender: UserGender.FEMALE,
      bio: 'Mình là B.',
      status: { isOnline: false, lastSeen: new Date(Date.now() - 3600000) },
      fcmTokens: [],
      isVerified: true,
      isBlocked: false,
    });

    const u3 = await this.userModel.create({
      phone: '0901000003',
      email: 'user3@zalo-chat.test',
      password: hash,
      fullName: 'Lê Văn C',
      avatar: 'https://i.pravatar.cc/150?u=3',
      gender: UserGender.MALE,
      bio: 'User C — nhóm chat.',
      status: { isOnline: true, lastSeen: new Date() },
      isVerified: false,
      isBlocked: false,
    });

    console.log(
      `✅ users: 3 (${u1.email}, ${u2.email}, ${u3.email}) — mật khẩu: 123456`,
    );

    await this.sessionModel.create({
      userId: u1._id,
      device: SessionDevice.WEB,
      deviceName: 'Chrome Windows',
      ip: '192.168.1.10',
      refreshToken: 'seed-rt-web-' + randomBytes(16).toString('hex'),
      expiredAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      isActive: true,
    });

    await this.sessionModel.create({
      userId: u1._id,
      device: SessionDevice.ANDROID,
      deviceName: 'Samsung Galaxy',
      ip: '10.0.0.5',
      refreshToken: 'seed-rt-android-' + randomBytes(16).toString('hex'),
      expiredAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      isActive: true,
    });
    console.log('✅ sessions: 2 (user1 web + android)');

    await this.friendshipModel.create({
      requesterId: u1._id,
      addresseeId: u2._id,
      status: FriendshipStatus.PENDING,
    });

    await this.friendshipModel.create({
      requesterId: u2._id,
      addresseeId: u3._id,
      status: FriendshipStatus.ACCEPTED,
    });

    await this.friendshipModel.create({
      requesterId: u1._id,
      addresseeId: u3._id,
      status: FriendshipStatus.ACCEPTED,
    });
    console.log('✅ friendships: 3 (1 PENDING, 2 ACCEPTED)');

    const privateConv = await this.conversationModel.create({
      type: ConversationType.PRIVATE,
      name: '',
      avatar: '',
      members: [
        {
          userId: u1._id,
          role: ConversationMemberRole.MEMBER,
          nickname: 'A',
          joinedAt: new Date(),
        },
        {
          userId: u2._id,
          role: ConversationMemberRole.MEMBER,
          nickname: 'B',
          joinedAt: new Date(),
        },
      ],
      lastMessage: null,
    });

    const groupConv = await this.conversationModel.create({
      type: ConversationType.GROUP,
      name: 'Nhóm CNM Zalo',
      avatar: 'https://picsum.photos/seed/group/200/200',
      members: [
        {
          userId: u1._id,
          role: ConversationMemberRole.ADMIN,
          nickname: 'Admin A',
          joinedAt: new Date(),
        },
        {
          userId: u2._id,
          role: ConversationMemberRole.MODERATOR,
          nickname: 'Mod B',
          joinedAt: new Date(),
        },
        {
          userId: u3._id,
          role: ConversationMemberRole.MEMBER,
          nickname: 'C',
          joinedAt: new Date(),
        },
      ],
      lastMessage: null,
    });
    console.log('✅ conversations: 1 PRIVATE + 1 GROUP');

    const m1 = await this.messageModel.create({
      conversationId: privateConv._id,
      senderId: u1._id,
      type: MessageType.TEXT,
      content: 'Chào B, khỏe không?',
      metadata: {},
      replyTo: null,
      status: MessageStatus.SEEN,
      isRecalled: false,
      deletedBy: [],
      reactions: [{ userId: u2._id, type: ReactionType.LOVE }],
      seenBy: [
        { userId: u2._id, seenAt: new Date() },
        { userId: u1._id, seenAt: new Date() },
      ],
    });

    const m2 = await this.messageModel.create({
      conversationId: privateConv._id,
      senderId: u2._id,
      type: MessageType.TEXT,
      content: 'Chào A, mình khỏe!',
      metadata: {},
      replyTo: m1._id,
      status: MessageStatus.DELIVERED,
      isRecalled: false,
      deletedBy: [],
      reactions: [],
      seenBy: [{ userId: u2._id, seenAt: new Date() }],
    });

    const m3 = await this.messageModel.create({
      conversationId: groupConv._id,
      senderId: u3._id,
      type: MessageType.TEXT,
      content: 'Hello cả nhóm 👋',
      metadata: {},
      replyTo: null,
      status: MessageStatus.SENT,
      isRecalled: false,
      deletedBy: [],
      reactions: [
        { userId: u1._id, type: ReactionType.HAHA },
        { userId: u2._id, type: ReactionType.LIKE },
      ],
      seenBy: [],
    });

    await this.messageModel.create({
      conversationId: groupConv._id,
      senderId: u1._id,
      type: MessageType.IMAGE,
      content: 'https://picsum.photos/seed/msgimg/600/400',
      metadata: {
        fileName: 'photo.jpg',
        fileSize: 120000,
        thumbnail: 'https://picsum.photos/seed/thumb/200/200',
        lat: null,
        lng: null,
        duration: null,
      },
      replyTo: null,
      status: MessageStatus.SENT,
      isRecalled: false,
      deletedBy: [],
      reactions: [],
      seenBy: [],
    });

    console.log('✅ messages: 4 (TEXT + reply + GROUP + IMAGE)');

    await this.conversationModel.findByIdAndUpdate(privateConv._id, {
      lastMessage: {
        messageId: m2._id,
        content: m2.content,
        senderId: m2.senderId,
        createdAt: m2.get('createdAt') as Date,
      },
    });

    await this.conversationModel.findByIdAndUpdate(groupConv._id, {
      lastMessage: {
        messageId: m3._id,
        content: m3.content,
        senderId: m3.senderId,
        createdAt: m3.get('createdAt') as Date,
      },
    });

    await this.callModel.create({
      conversationId: privateConv._id,
      callerId: u1._id,
      participants: [u2._id],
      type: CallType.VOICE,
      status: CallStatus.ENDED,
      startedAt: new Date(Date.now() - 3600000),
      endedAt: new Date(Date.now() - 3500000),
      duration: 100,
    });

    await this.callModel.create({
      conversationId: groupConv._id,
      callerId: u2._id,
      participants: [u1._id, u3._id],
      type: CallType.VIDEO,
      status: CallStatus.MISSED,
      startedAt: null,
      endedAt: null,
      duration: 0,
    });
    console.log('✅ calls: 2 (VOICE ENDED + VIDEO MISSED)');

    await this.notificationModel.create({
      receiverId: u2._id,
      type: NotificationType.MESSAGE,
      content: 'Bạn có tin nhắn mới từ A',
      data: {
        senderId: u1._id,
        conversationId: privateConv._id,
        messageId: m1._id,
      },
      isRead: false,
    });

    await this.notificationModel.create({
      receiverId: u3._id,
      type: NotificationType.FRIEND_REQUEST,
      content: 'Lời mời kết bạn (seed)',
      data: {
        senderId: u1._id,
        conversationId: null,
        messageId: null,
      },
      isRead: true,
    });

    await this.notificationModel.create({
      receiverId: u1._id,
      type: NotificationType.CALL,
      content: 'Cuộc gọi nhỡ từ B',
      data: {
        senderId: u2._id,
        conversationId: groupConv._id,
        messageId: null,
      },
      isRead: false,
    });
    console.log('✅ notifications: 3');

    const storyExpires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await this.storyModel.create({
      userId: u1._id,
      mediaUrl: 'https://picsum.photos/seed/story1/400/700',
      type: StoryMediaType.IMAGE,
      caption: 'Story demo — ảnh',
      viewers: [u2._id],
      expiresAt: storyExpires,
    });

    await this.storyModel.create({
      userId: u2._id,
      mediaUrl: 'https://example.com/seed-video-placeholder.mp4',
      type: StoryMediaType.VIDEO,
      caption: 'Story video (URL giả lập)',
      viewers: [],
      expiresAt: storyExpires,
    });
    console.log('✅ stories: 2 (IMAGE + VIDEO, hết hạn sau 7 ngày)');

    await this.reportModel.create({
      reporterId: u2._id,
      targetUserId: u3._id,
      reason: 'Nội dung không phù hợp (seed)',
      description: 'Báo cáo mẫu cho admin.',
      status: ReportStatus.PENDING,
    });

    await this.reportModel.create({
      reporterId: u1._id,
      targetUserId: u3._id,
      reason: 'Spam (seed)',
      description: 'Đã xử lý trong demo.',
      status: ReportStatus.RESOLVED,
    });
    console.log('✅ reports: 2 (PENDING + RESOLVED)');

    console.log('🎉 Seed hoàn tất.');
  }

  private async clearAll(): Promise<void> {
    await this.reportModel.deleteMany({});
    await this.storyModel.deleteMany({});
    await this.notificationModel.deleteMany({});
    await this.callModel.deleteMany({});
    await this.messageModel.deleteMany({});
    await this.conversationModel.deleteMany({});
    await this.friendshipModel.deleteMany({});
    await this.sessionModel.deleteMany({});
    await this.userModel.deleteMany({});
    console.log('🗑️  Đã xóa dữ liệu cũ các collection seed.');
  }
}

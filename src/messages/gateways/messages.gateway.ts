import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagesService } from '../messages.service';
import { UsersService } from '../../users/users.service'; // 👈 Cần import UsersService
import { FriendshipsService } from '../../friendships/friendships.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { CreateMessageDto } from '../dto/create-message.dto';
import { MessageStatus, MessageType, ReactionType } from '../schemas/message.schema';
import { instrument } from '@socket.io/admin-ui';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';

@WebSocketGateway({
  cors: {
    origin: '*', 
    credentials: true,
  },
  transports: ['websocket'],
})
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('MessagesGateway');
  private readonly userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly messagesService: MessagesService,
    private readonly usersService: UsersService, // 👈 Inject UsersService vào đây
    private readonly friendshipsService: FriendshipsService,
    private readonly conversationsService: ConversationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit() {
    this.realtimeService.setServer(this.server);
    instrument(this.server, {
      auth: false,
      mode: 'development',
    });
    this.logger.log('Sẵn sàng cho Socket.io Admin UI!');
  }

  // Khi người dùng kết nối (Online)
  async handleConnection(client: Socket) {
    const userId = this.getUserId(client);
    if (!userId) {
      return;
    }

    client.data.userId = userId;
    client.join(userId);

    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(client.id);
    this.userSockets.set(userId, sockets);

    const lastSeen = new Date();
    await this.usersService.updateStatus2(userId, {
      isOnline: true,
      lastSeen,
    });

    if (wasOffline) {
      await this.broadcastUserStatus(userId, true, lastSeen);
      this.logger.log(`User ${userId} is online`);
    }
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(
    @MessageBody('userId') userId: string,
    @ConnectedSocket() client: Socket,
  ) {
    if (userId) {
      client.join(userId);
    }
  }

  // Khi người dùng ngắt kết nối (Offline)
  async handleDisconnect(client: Socket) {
    this.broadcastStopTypingOnDisconnect(client);

    const userId = this.getUserId(client);
    if (!userId) {
      return;
    }

    const sockets = this.userSockets.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(client.id);
    if (sockets.size > 0) {
      this.userSockets.set(userId, sockets);
      return;
    }

    this.userSockets.delete(userId);

    const lastSeen = new Date();
    await this.usersService.updateStatus2(userId, {
      isOnline: false,
      lastSeen,
    });

    await this.broadcastUserStatus(userId, false, lastSeen);
    this.logger.log(`User ${userId} is offline`);
  }

  @SubscribeMessage('join_conversation')
  handleJoinConversation(
    @MessageBody('conversationId') conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    if (conversationId) {
      client.join(conversationId);
    }
  }

  private getUserId(client: Socket): string | null {
    const rawUserId = client.handshake.query.userId ?? client.data.userId;
    if (Array.isArray(rawUserId)) {
      return rawUserId[0] ?? null;
    }
    return typeof rawUserId === 'string' && rawUserId.trim().length > 0
      ? rawUserId.trim()
      : null;
  }

  private normalizeUserStatusPayload(
    userId: string,
    isOnline: boolean,
    lastSeen: Date,
  ) {
    return {
      userId,
      isOnline,
      lastSeen: lastSeen.toISOString(),
    };
  }

  private async getUserStatusRecipients(userId: string): Promise<string[]> {
    const [friendIds, conversationMemberIds] = await Promise.all([
      this.friendshipsService.findAcceptedFriendIdsByUserId(userId),
      this.conversationsService.findMemberUserIdsByUserId(userId),
    ]);

    return Array.from(new Set([userId, ...friendIds, ...conversationMemberIds]));
  }

  private async broadcastUserStatus(
    userId: string,
    isOnline: boolean,
    lastSeen: Date,
  ): Promise<void> {
    const payload = this.normalizeUserStatusPayload(userId, isOnline, lastSeen);
    const recipientIds = await this.getUserStatusRecipients(userId);

    for (const recipientId of recipientIds) {
      this.server.to(recipientId).emit('user_status_changed', payload);
    }
  }

  private broadcastStopTypingOnDisconnect(client: Socket): void {
    const userId = this.getUserId(client);
    if (!userId) {
      return;
    }

    for (const roomId of client.rooms) {
      if (roomId === client.id || roomId === userId) {
        continue;
      }

      client.to(roomId).emit('stop_typing', {
        conversationId: roomId,
        userId,
      });
    }
  }

  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @SubscribeMessage('send_message')
  async handleSendMessage(@MessageBody() dto: CreateMessageDto) {
    try {
      const savedMsg = await this.messagesService.create(dto);
      this.server.to(dto.conversationId).emit('new_message', savedMsg);
      return savedMsg;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`LỖI: ${error.message}`);
        return { status: 'error', message: error.message };
      } else {
        this.logger.error(`LỖI: ${String(error)}`);
        return { status: 'error', message: 'Unknown error' };
      }
    }
  }

  @SubscribeMessage('recall_message')
  async handleRecall(
    @MessageBody() data: { messageId: string; conversationId: string },
  ) {
    await this.messagesService.update(data.messageId, { isRecalled: true });
    this.server
      .to(data.conversationId)
      .emit('message_recalled', { messageId: data.messageId });
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.conversationId || !data?.userId) {
      return;
    }

    // Chỉ phát trong room hội thoại, trừ chính người gửi để tránh loop UI.
    if (!client.rooms.has(data.conversationId)) {
      return;
    }

    client.to(data.conversationId).emit('typing', {
      conversationId: data.conversationId,
      userId: data.userId,
    });
  }

  @SubscribeMessage('stop_typing')
  handleStopTyping(
    @MessageBody() data: { conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.conversationId || !data?.userId) {
      return;
    }

    if (!client.rooms.has(data.conversationId)) {
      return;
    }

    client.to(data.conversationId).emit('stop_typing', {
      conversationId: data.conversationId,
      userId: data.userId,
    });
  }

  @SubscribeMessage('add_reaction')
  async handleReaction(
    @MessageBody() data: { messageId: string; userId: string; type: ReactionType; conversationId: string },
  ) {
    const updatedMsg = await this.messagesService.upsertReaction(
      data.messageId,
      data.userId,
      data.type,
    );
    this.server.to(data.conversationId).emit('message_updated', updatedMsg);
  }

  @SubscribeMessage('remove_reaction')
  async handleRemoveReaction(
    @MessageBody() data: { messageId: string; userId: string; conversationId: string },
  ) {
    const updatedMsg = await this.messagesService.removeReaction(
      data.messageId,
      data.userId,
    );
    this.server.to(data.conversationId).emit('message_updated', updatedMsg);
  }

  @SubscribeMessage('seen_conversation')
  async handleSeenConversation(
    @MessageBody() data: { conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { conversationId, userId } = data;
      if (!conversationId || !userId) return;

      // Lấy tất cả messages chưa seen bởi user này
      const messages = await this.messagesService.findUnseenMessages(
        conversationId,
        userId,
      );

      if (messages.length === 0) return;

      const seenAt = new Date();

      // Bulk update seenBy cho tất cả messages chưa đọc
      await this.messagesService.bulkMarkSeen(
        messages.map((m) => m._id.toString()),
        userId,
        seenAt,
      );

      // Lấy message mới nhất để emit event
      const latestMessage = messages[messages.length - 1];

      // Emit cho tất cả trong room biết đã đọc
      this.server.to(conversationId).emit('message_seen', {
        conversationId,
        messageId: latestMessage._id.toString(),
        userId,
        status: 'SEEN',
        seenBy: [{ userId, seenAt: seenAt.toISOString() }],
      });
    } catch (e) {
      if (e instanceof Error) {
        this.logger.error('seen_conversation error: ' + e.message);
      } else {
        this.logger.error('seen_conversation error: ' + String(e));
      }
    }
}

  @SubscribeMessage('edit_message')
  async handleEditMessage(
    @MessageBody() data: { messageId: string; content: any; conversationId: string },
  ) {
    const updatedMsg = await this.messagesService.update(data.messageId, {
      content: data.content,
    });
    this.server.to(data.conversationId).emit('message_edited', updatedMsg);
    return updatedMsg;
  }

  @SubscribeMessage('delete_message_me')
  async handleDeleteForMe(
    @MessageBody() data: { messageId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const updatedMsg = await this.messagesService.addDeletedBy(data.messageId, data.userId);
    client.emit('message_deleted_local', { messageId: data.messageId });
    return updatedMsg;
  }

  @SubscribeMessage('pin_message')
  async handlePinMessage(
    @MessageBody()
    data: { messageId: string; conversationId: string; userId: string },
  ) {
    try {
      const { messageId, conversationId, userId } = data;
      if (!messageId || !conversationId || !userId) {
        return { status: 'error', message: 'Thiếu messageId/conversationId/userId' };
      }

      const [updatedMessage, pinResult] = await Promise.all([
        this.messagesService.update(messageId, { isPinned: true }),
        this.conversationsService.addPinnedMessageId(conversationId, messageId),
      ]);

      let systemMessage: Record<string, unknown> | null = null;
      if (pinResult.wasAdded) {
        systemMessage = await this.messagesService.create({
          conversationId,
          senderId: userId,
          type: MessageType.SYSTEM,
          content: 'Bạn đã ghim một tin nhắn',
          metadata: {
            fileName: '',
            fileSize: null,
            thumbnail: '',
            lat: null,
            lng: null,
            duration: null,
            systemAction: 'PINNED',
            pinnedMessageId: messageId,
            conversationId,
            system: true,
          } as never,
          status: MessageStatus.SENT,
        });
        this.server.to(conversationId).emit('new_message', systemMessage);
      }

      const payload = {
        conversationId,
        messageId,
        action: 'PINNED',
        message: updatedMessage,
      };
      this.server.to(conversationId).emit('message_pinned_update', payload);

      return {
        ...payload,
        systemMessage,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`pin_message error: ${error.message}`);
        return { status: 'error', message: error.message };
      }

      this.logger.error(`pin_message error: ${String(error)}`);
      return { status: 'error', message: 'Unknown error' };
    }
  }

  @SubscribeMessage('unpin_message')
  async handleUnpinMessage(
    @MessageBody()
    data: { messageId: string; conversationId: string; userId: string },
  ) {
    try {
      const { messageId, conversationId, userId } = data;
      if (!messageId || !conversationId) {
        return { status: 'error', message: 'Thiếu messageId/conversationId' };
      }

      const [updatedMessage] = await Promise.all([
        this.messagesService.update(messageId, { isPinned: false }),
        this.conversationsService.removePinnedMessageId(conversationId, messageId),
      ]);

      const payload = {
        conversationId,
        messageId,
        action: 'UNPINNED',
        message: updatedMessage,
      };

      this.server.to(conversationId).emit('message_pinned_update', payload);
      return payload;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`unpin_message error: ${error.message}`);
        return { status: 'error', message: error.message };
      }

      this.logger.error(`unpin_message error: ${String(error)}`);
      return { status: 'error', message: 'Unknown error' };
    }
  }
}

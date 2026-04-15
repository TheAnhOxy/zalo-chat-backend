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
import { CreateMessageDto } from '../dto/create-message.dto';
import { ReactionType } from '../schemas/message.schema';
import { instrument } from '@socket.io/admin-ui';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';

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
  private activeUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private readonly messagesService: MessagesService,
    private readonly usersService: UsersService, // 👈 Inject UsersService vào đây
  ) {}

  afterInit() {
    instrument(this.server, {
      auth: false,
      mode: 'development',
    });
    this.logger.log('Sẵn sàng cho Socket.io Admin UI!');
  }

  // Khi người dùng kết nối (Online)
  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      client.join(userId);
      this.activeUsers.set(userId, client.id);

      // Cập nhật trạng thái vào lồng object 'status' theo Schema của bạn
      await this.usersService.updateStatus2(userId, {
        isOnline: true,
        lastSeen: new Date(),
      });

      // Phát sự kiện cho toàn bộ hệ thống để hiện chấm xanh
      this.server.emit('user_status_changed', {
        userId,
        isOnline: true,
      });

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
    let disconnectedUserId: string | null = null;

    // Tìm userId dựa trên socketId đang ngắt kết nối
    for (const [userId, socketId] of this.activeUsers.entries()) {
      if (socketId === client.id) {
        disconnectedUserId = userId;
        this.activeUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUserId) {
      const now = new Date();
      // Cập nhật DB trạng thái ngoại tuyến và thời gian cuối
      await this.usersService.updateStatus2(disconnectedUserId, {
        isOnline: false,
        lastSeen: new Date(),
      });

      // Thông báo cho mọi người để tắt chấm xanh và hiện "Ngoại tuyến"
      this.server.emit('user_status_changed', {
        userId: disconnectedUserId,
        isOnline: false,
        lastSeen: now,
      });

      this.logger.log(`User ${disconnectedUserId} is offline`);
    }
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
    @MessageBody()
    data: {
      conversationId: string;
      userId: string;
      isTyping: boolean;
    },
  ) {
    this.server.to(data.conversationId).emit('user_typing', data);
  }

  @SubscribeMessage('add_reaction')
  async handleReaction(
    @MessageBody()
    data: {
      messageId: string;
      userId: string;
      type: ReactionType;
      conversationId: string;
    },
  ) {
    const updatedMsg = await this.messagesService.upsertReaction(
      data.messageId,
      data.userId,
      data.type,
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
    @MessageBody()
    data: {
      messageId: string;
      content: string;
      conversationId: string;
    },
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
    const updatedMsg = await this.messagesService.addDeletedBy(
      data.messageId,
      data.userId,
    );
    client.emit('message_deleted_local', { messageId: data.messageId });
    return updatedMsg;
  }
}

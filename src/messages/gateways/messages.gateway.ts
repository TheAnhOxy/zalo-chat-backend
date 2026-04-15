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
import { CreateMessageDto } from '../dto/create-message.dto';
import { ReactionType } from '../schemas/message.schema';
import { instrument } from '@socket.io/admin-ui';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*', // Cho phép tất cả các cổng của Flutter Web
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
  private activeUsers = new Map<string, string>();

  constructor(private readonly messagesService: MessagesService) {}

  afterInit() {
    instrument(this.server, {
      auth: false,
      mode: 'development',
    });
    this.logger.log('Sẵn sàng cho Socket.io Admin UI!');
  }

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.activeUsers.set(userId, client.id);
      this.server.emit('user_online', { userId });
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.activeUsers.entries()) {
      if (socketId === client.id) {
        this.activeUsers.delete(userId);
        this.server.emit('user_offline', { userId });
        break;
      }
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

  // ✅ FIX CHÍNH Ở ĐÂY
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @SubscribeMessage('send_message')
  async handleSendMessage(@MessageBody() dto: CreateMessageDto) {
    this.logger.debug('==== GATEWAY NHẬN DỮ LIỆU ====');
    this.logger.debug(JSON.stringify(dto));

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
}

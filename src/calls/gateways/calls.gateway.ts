import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CallsService } from '../calls.service';
import { CreateCallDto } from '../dto/create-call.dto';
import { CallStatus } from '../schemas/call.schema';
import { Logger } from '@nestjs/common';
import { ConversationsService } from '../../conversations/conversations.service';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class CallsGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallsGateway.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * 1. Bắt đầu cuộc gọi
   * Gửi Offer từ Caller tới tất cả thành viên trong Room
   */
  @SubscribeMessage('start_call')
  async handleStartCall(
    @MessageBody() data: { callDto: CreateCallDto; offer: any },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `User ${data.callDto.callerId} starting call in room ${data.callDto.conversationId}`,
    );

    // Lưu bản ghi cuộc gọi vào DB (Trạng thái: CALLING)
    const callRecord = await this.callsService.create(data.callDto);

    client.emit('call_created', {
      callId: callRecord._id,
    });
    // // Gửi tín hiệu 'incoming_call' cho tất cả mọi người trong room TRỪ người gọi
    // client.to(data.callDto.conversationId).emit('incoming_call', {
    //   callId: callRecord._id,
    //   offer: data.offer,
    //   callerId: data.callDto.callerId,
    //   type: data.callDto.type,
    //   conversationId: data.callDto.conversationId,
    // });

    // Gửi vào room userId của từng participant:
    for (const participantId of data.callDto.participants) {
      client.to(participantId.toString()).emit('incoming_call', {
        callId: callRecord._id,
        offer: data.offer,
        callerId: data.callDto.callerId,
        callerName: data.callDto.callerName, // thêm
        callerAvatar: data.callDto.callerAvatar, // thêm
        type: data.callDto.type,
        conversationId: data.callDto.conversationId,
      });
    }

    return callRecord;
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.userId);
    this.logger.log(`User ${data.userId} joined their personal room`);
  }

  /**
   * 2. Trả lời cuộc gọi
   * Cập nhật DB và gửi Answer lại cho Caller
   */
  @SubscribeMessage('answer_call')
  async handleAnswerCall(
    @MessageBody()
    data: { conversationId: string; answer: any; callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `Call ${data.callId} accepted in room ${data.conversationId}`,
    );

    // Cập nhật trạng thái bắt đầu cuộc gọi thực tế vào DB
    await this.callsService.update(data.callId, {
      status: CallStatus.ACCEPTED,
    });

    // Gửi Answer cho mọi người trong room TRỪ người vừa nhấn nghe (User 2)
    // Người gọi (User 1) sẽ nhận được cái này để bắt đầu kết nối P2P
    client.to(data.conversationId).emit('call_answered', {
      answer: data.answer,
      callId: data.callId,
    });
  }

  /**
   * 3. Trao đổi ICE Candidates
   * Giúp 2 thiết bị xuyên thủng tường lửa để thấy nhau
   */
  @SubscribeMessage('ice_candidate')
  handleIceCandidate(
    @MessageBody()
    data: {
      conversationId: string;
      candidate: string;
      sdpMid: string;
      sdpMLineIndex: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.conversationId).emit('ice_candidate', {
      candidate: data.candidate,
      sdpMid: data.sdpMid,
      sdpMLineIndex: data.sdpMLineIndex,
    });
  }

  /**
   * 4. Kết thúc cuộc gọi
   * Tính toán thời lượng (duration) và cập nhật DB
   */
  @SubscribeMessage('end_call')
  async handleEndCall(
    @MessageBody() data: { callId: string; conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const call = await this.callsService.findById(data.callId);
    let finalDuration = 0;

    if (call && call.startedAt) {
      const startTime = new Date(call.startedAt as string).getTime();
      const endTime = new Date().getTime();
      finalDuration = Math.round((endTime - startTime) / 1000);
    }

    const updatedCall = await this.callsService.update(data.callId, {
      status: CallStatus.ENDED,
      duration: finalDuration,
      endedAt: new Date().toISOString(),
    });

    const callType =
      (call?.type as string) === 'VIDEO' ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
    const mins = Math.floor(finalDuration / 60);
    const secs = String(finalDuration % 60).padStart(2, '0');
    const durationText = finalDuration > 0 ? ` • ${mins}:${secs}` : '';
    const lastContent = `📞 ${callType}${durationText}`;

    // ✅ Cập nhật lastMessage DB
    try {
      await this.conversationsService.updateLastMessage(data.conversationId, {
        content: lastContent,
        senderId: call?.callerId?.toString() ?? '',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(err);
    }

    // ✅ Emit call_ended cho cả 2 bên (broadcast toàn room + người gọi)
    // Emit cho người kia
    client.to(data.conversationId).emit('call_ended', {
      callId: data.callId,
      callData: updatedCall, // ← gửi kèm data để Flutter thêm vào chatItems
    });

    // ✅ Emit conversation_updated để cập nhật lastMessage realtime
    this.server.to(data.conversationId).emit('conversation_call_updated', {
      conversationId: data.conversationId,
      lastMessage: {
        content: lastContent,
        senderId: call?.callerId?.toString() ?? '',
        createdAt: new Date().toISOString(),
      },
      callData: updatedCall,
    });

    return updatedCall;
  }

  @SubscribeMessage('reject_call')
  async handleRejectCall(
    @MessageBody() data: { callId: string; conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    await this.callsService.update(data.callId, {
      status: CallStatus.REJECTED,
    });

    const lastContent = '📞 Cuộc gọi nhỡ';

    try {
      const call = await this.callsService.findById(data.callId);
      await this.conversationsService.updateLastMessage(data.conversationId, {
        content: lastContent,
        senderId: call?.callerId?.toString() ?? '',
        createdAt: new Date().toISOString(),
      });
    } catch (e) {}

    client
      .to(data.conversationId)
      .emit('call_rejected', { callId: data.callId });

    // ✅ Emit để cập nhật UI
    this.server.to(data.conversationId).emit('conversation_call_updated', {
      conversationId: data.conversationId,
      lastMessage: {
        content: lastContent,
        createdAt: new Date().toISOString(),
      },
    });
  }
  @SubscribeMessage('call_connected')
  async handleConnected(@MessageBody() data: { callId: string }) {
    this.logger.log(`Call ${data.callId} connected`);

    await this.callsService.update(data.callId, {
      startedAt: new Date().toISOString(),
      status: CallStatus.ACCEPTED,
    });
  }
}

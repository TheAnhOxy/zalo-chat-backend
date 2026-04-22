import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Types } from 'mongoose';
import { CallsService } from '../calls.service';
import { CreateCallDto } from '../dto/create-call.dto';
import { CallStatus } from '../schemas/call.schema';
import { Logger } from '@nestjs/common';
import { ConversationsService } from '../../conversations/conversations.service';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class CallsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallsGateway.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;

    if (userId) {
      client.join(userId);
      this.logger.log(`User ${userId} joined personal room ${userId}`);
    }
  }

  /**
   * 1. Bắt đầu cuộc gọi
   * Gửi Offer từ Caller tới tất cả thành viên trong Room
   */
  @SubscribeMessage('start_call')
  async handleStartCall(
    @MessageBody()
    data: {
      callDto: CreateCallDto;
      offer?: any;
      offers?: Array<{ targetId: string; offer: any }>;
    },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `User ${data.callDto.callerId} starting call in room ${data.callDto.conversationId}`,
    );

    // Ensure caller is in call room early to receive participant events.
    client.join(data.callDto.conversationId);

    // Lưu bản ghi cuộc gọi vào DB (Trạng thái: CALLING)
    const callRecord = await this.callsService.create(data.callDto);

    client.emit('call_created', {
      callId: callRecord._id,
      conversationId: data.callDto.conversationId,
    });

    const isGroup = (data.callDto.participants?.length ?? 0) > 1;
    let groupName = '';
    let groupAvatar = '';

    if (isGroup) {
      try {
        const conversation = await this.conversationsService.findById(
          data.callDto.conversationId,
        );
        groupName = (conversation['name'] as string) ?? '';
        groupAvatar = (conversation['avatar'] as string) ?? '';
      } catch (error) {
        this.logger.warn(
          `Không lấy được thông tin nhóm cho conversation ${data.callDto.conversationId}`,
        );
      }
    }

    if (Array.isArray(data.offers) && data.offers.length > 0) {
      for (const offerEntry of data.offers) {
        if (!offerEntry?.targetId) continue;

        this.server.to(offerEntry.targetId.toString()).emit('incoming_call', {
          callId: callRecord._id,
          offer: offerEntry.offer,
          callerId: data.callDto.callerId,
          callerName: data.callDto.callerName,
          callerAvatar: data.callDto.callerAvatar,
          type: data.callDto.type,
          conversationId: data.callDto.conversationId,
          participants: data.callDto.participants,
          isGroup,
          groupName,
          groupAvatar,
        });
      }
    } else {
      for (const receiverId of data.callDto.participants) {
        this.server.to(receiverId.toString()).emit('incoming_call', {
          callId: callRecord._id,
          offer: data.offer,
          callerId: data.callDto.callerId,
          callerName: data.callDto.callerName,
          callerAvatar: data.callDto.callerAvatar,
          type: data.callDto.type,
          conversationId: data.callDto.conversationId,
          participants: data.callDto.participants,
          isGroup,
          groupName,
          groupAvatar,
        });
      }
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
    data: {
      conversationId: string;
      answer: any;
      callId: string;
      targetId?: string;
      sourceId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `Call ${data.callId} accepted in room ${data.conversationId}`,
    );

    const call = await this.callsService.findById(data.callId);
    const callerId = (call?.callerId as any)?.toString?.();
    const responderId = client.handshake.query.userId as string;
    const targetId = data.targetId ?? callerId;

    // Cập nhật trạng thái bắt đầu cuộc gọi thực tế vào DB
    await this.callsService.update(data.callId, {
      status: CallStatus.ACCEPTED,
    });

    if (targetId) {
      this.server.to(targetId).emit('call_answered', {
        answer: data.answer,
        callId: data.callId,
        responderId,
        isGroup: (call?.participants as any)?.length > 1,
        sourceId: responderId,
        targetId,
      });
    }
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
      targetId?: string;
      sourceId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const payload = {
      candidate: data.candidate,
      sdpMid: data.sdpMid,
      sdpMLineIndex: data.sdpMLineIndex,
      sourceId: data.sourceId ?? (client.handshake.query.userId as string),
      targetId: data.targetId,
      conversationId: data.conversationId,
    };

    if (data.targetId) {
      this.server.to(data.targetId).emit('ice_candidate', payload);
      return;
    }

    client.to(data.conversationId).emit('ice_candidate', payload);
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
    const call = await this.callsService.findById(data.callId);
    const callerId = (call?.callerId as any)?.toString?.();
    const isGroup = (call?.participants as any)?.length > 1;

    if (!isGroup) {
      await this.callsService.update(data.callId, {
        status: CallStatus.REJECTED,
      });
    }

    const lastContent = '📞 Cuộc gọi nhỡ';

    if (!isGroup) {
      try {
        await this.conversationsService.updateLastMessage(data.conversationId, {
          content: lastContent,
          senderId: call?.callerId?.toString() ?? '',
          createdAt: new Date().toISOString(),
        });
      } catch (e) {}
    }

    if (callerId) {
      this.server.to(callerId).emit('call_rejected', {
        callId: data.callId,
        rejecterId: client.handshake.query.userId as string,
        isGroup,
      });
    }

    if (!isGroup) {
      this.server.to(data.conversationId).emit('conversation_call_updated', {
        conversationId: data.conversationId,
        lastMessage: {
          content: lastContent,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }
  @SubscribeMessage('call_connected')
  async handleConnected(
    @MessageBody() data: { callId: string; conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Call ${data.callId} connected by user ${data.userId}`);

    // ✅ Socket JOIN conversationId room để nhận broadcast events
    client.join(data.conversationId);
    this.logger.log(`Socket joined room ${data.conversationId}`);

    // ✅ Lấy call hiện tại để check xem startedAt đã tồn tại chưa
    const existingCall = await this.callsService.findById(data.callId);
    const isFirstConnection = !existingCall?.startedAt;
    const existingActiveIds = ((existingCall?.activeParticipants ?? []) as any[])
      .map((id) => id?.toString?.() ?? '')
      .filter((id) => id.length > 0);
    const wasAlreadyActive = existingActiveIds.includes(data.userId);

    let startedAt = existingCall?.startedAt
      ? (existingCall.startedAt as Date).toISOString()
      : new Date().toISOString();

    // ✅ Atomic add user to activeParticipants (avoid race condition)
    // Dùng $addToSet để chỉ add nếu chưa tồn tại
    const updateData: any = {
      startedAt: startedAt,
      status: CallStatus.ACCEPTED,
    };

    // Use atomic $addToSet operator
    const updatedCall = await (this.callsService as any).callModel.findByIdAndUpdate(
      data.callId,
      {
        $set: {
          startedAt: startedAt,
          status: CallStatus.ACCEPTED,
        },
        $addToSet: {
          activeParticipants: new Types.ObjectId(data.userId),
        },
      },
      { new: true },
    );

    this.logger.log(
      `Added ${data.userId} to activeParticipants. Total: ${(updatedCall?.activeParticipants as any[])?.length ?? 0}`,
    );

    const activeParticipantIds = ((updatedCall?.activeParticipants ?? []) as any[])
      .map((id) => id?.toString?.() ?? '')
      .filter((id) => id.length > 0);

    // Sync full active participants list to the just-connected client.
    client.emit('active_participants', {
      callId: data.callId,
      conversationId: data.conversationId,
      activeParticipants: activeParticipantIds,
    });

    if (!wasAlreadyActive) {
      this.server.to(data.conversationId).emit('participant_joined', {
        callId: data.callId,
        userId: data.userId,
        activeParticipantsCount:
          (updatedCall?.activeParticipants as any[])?.length ?? 0,
      });
    }

    // ✅ CHỈ emit call_started lần đầu tiên
    if (isFirstConnection) {
      this.logger.log('📢 Broadcasting call_started (first connection)');
      this.server.to(data.conversationId).emit('call_started', {
        callId: data.callId,
        startedAt: startedAt,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * ✅ 5. Người rời cuộc gọi nhóm (nhưng call vẫn tiếp tục nếu còn 2+ người)
   */
  @SubscribeMessage('leave_call')
  async handleLeaveCall(
    @MessageBody()
    data: {
      callId: string;
      conversationId: string;
      userId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `User ${data.userId} leaving call ${data.callId} in room ${data.conversationId}`,
    );

    const call = await this.callsService.findById(data.callId);
    if (!call) {
      this.logger.warn(`Call ${data.callId} not found`);
      return;
    }

    // Cập nhật activeParticipants (loại bỏ user này)
    const activeParticipants = ((call.activeParticipants || call.participants) as any[])
      .map((id) => id?.toString?.() ?? '')
      .filter((id) => id !== data.userId);

    await this.callsService.update(data.callId, {
      activeParticipants: activeParticipants,
    });

    this.logger.log(
      `Updated activeParticipants: ${activeParticipants.length} remaining`,
    );

    // Nếu còn ít nhất 2 người → call tiếp tục
    if (activeParticipants.length >= 2) {
      // 🔴 Notify room: Có 1 người rời (nhưng call vẫn tiếp tục)
      this.server.to(data.conversationId).emit('participant_left', {
        callId: data.callId,
        userId: data.userId,
        activeParticipantsCount: activeParticipants.length,
      });
      return;
    }

    // Nếu chỉ còn dưới 2 người → kết thúc call
    this.logger.log(`Only ${activeParticipants.length} active, ending call`);

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

    try {
      await this.conversationsService.updateLastMessage(data.conversationId, {
        content: lastContent,
        senderId: call?.callerId?.toString() ?? '',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(err);
    }

    // 🔴 Notify: Call kết thúc (tất cả mọi người)
    this.server.to(data.conversationId).emit('call_ended', {
      callId: data.callId,
      reason: 'Không đủ người tham gia',
      callData: updatedCall,
    });

    this.server.to(data.conversationId).emit('conversation_call_updated', {
      conversationId: data.conversationId,
      lastMessage: {
        content: lastContent,
        senderId: call?.callerId?.toString() ?? '',
        createdAt: new Date().toISOString(),
      },
      callData: updatedCall,
    });
  }
}

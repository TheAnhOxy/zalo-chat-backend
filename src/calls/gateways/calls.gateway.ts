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

@WebSocketGateway({
  cors: { origin: '*' },
})
export class CallsGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallsGateway.name);

  constructor(private readonly callsService: CallsService) {}

  /**
   * 1. Bắt đầu cuộc gọi
   * Gửi Offer từ Caller tới tất cả thành viên trong Room
   */
  @SubscribeMessage('start_call')
  async handleStartCall(
    @MessageBody() data: { callDto: CreateCallDto; offer: any },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`User ${data.callDto.callerId} starting call in room ${data.callDto.conversationId}`);
    
    // Lưu bản ghi cuộc gọi vào DB (Trạng thái: CALLING)
    const callRecord = await this.callsService.create(data.callDto);
    
    // Gửi tín hiệu 'incoming_call' cho tất cả mọi người trong room TRỪ người gọi
    client.to(data.callDto.conversationId).emit('incoming_call', {
      callId: callRecord._id,
      offer: data.offer,
      callerId: data.callDto.callerId,
      type: data.callDto.type,
      conversationId: data.callDto.conversationId,
    });

    return callRecord;
  }

  /**
   * 2. Trả lời cuộc gọi
   * Cập nhật DB và gửi Answer lại cho Caller
   */
  @SubscribeMessage('answer_call')
  async handleAnswerCall(
    @MessageBody() data: { conversationId: string; answer: any; callId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Call ${data.callId} accepted in room ${data.conversationId}`);

    // Cập nhật trạng thái bắt đầu cuộc gọi thực tế vào DB
    await this.callsService.update(data.callId, { 
      status: CallStatus.ACCEPTED,
      startedAt: new Date().toISOString() 
    });

    // Gửi Answer cho mọi người trong room TRỪ người vừa nhấn nghe (User 2)
    // Người gọi (User 1) sẽ nhận được cái này để bắt đầu kết nối P2P
    client.to(data.conversationId).emit('call_answered', {
      answer: data.answer,
      callId: data.callId
    });
  }

  /**
   * 3. Trao đổi ICE Candidates
   * Giúp 2 thiết bị xuyên thủng tường lửa để thấy nhau
   */
  @SubscribeMessage('ice_candidate')
  handleIceCandidate(
    @MessageBody() data: { conversationId: string; candidate: any },
    @ConnectedSocket() client: Socket,
  ) {
    // Chỉ chuyển tiếp (broadcast) cho người kia, không gửi ngược lại cho chính mình
    client.to(data.conversationId).emit('ice_candidate', data.candidate);
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
    this.logger.log(`Call ${data.callId} ending`);

    const call = await this.callsService.findById(data.callId);
    let finalDuration = 0;

    if (call && call.startedAt) {
      const startTime = new Date(call.startedAt as string).getTime();
      const endTime = new Date().getTime();
      finalDuration = Math.round((endTime - startTime) / 1000); // Tính bằng giây
    }

    const updatedCall = await this.callsService.update(data.callId, {
      status: CallStatus.ENDED,
      duration: finalDuration,
      endedAt: new Date().toISOString(),
    });

    // Thông báo cho tất cả người còn lại trong room đóng màn hình cuộc gọi
    client.to(data.conversationId).emit('call_ended', { callId: data.callId });
    
    return updatedCall;
  }

  /**
   * 5. Từ chối cuộc gọi
   */
  @SubscribeMessage('reject_call')
  async handleRejectCall(
    @MessageBody() data: { callId: string; conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Call ${data.callId} rejected`);

    await this.callsService.update(data.callId, { status: CallStatus.REJECTED });
    
    // Báo cho người gọi biết cuộc gọi bị từ chối
    client.to(data.conversationId).emit('call_rejected', { callId: data.callId });
  }
}
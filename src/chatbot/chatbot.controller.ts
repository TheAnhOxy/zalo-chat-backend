import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  Param,
  Delete,
  Patch,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatbotService } from './chatbot.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

@ApiTags('Chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Danh sách cuộc trò chuyện chatbot theo userId' })
  async listConversations(@Query('userId') userId: string) {
    return this.chatbotService.listConversations(userId);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Tạo cuộc trò chuyện chatbot mới' })
  async createConversation(@Body() body: { userId: string; title?: string }) {
    return this.chatbotService.createConversation(body.userId, body.title);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: 'Đổi tên cuộc trò chuyện chatbot' })
  async renameConversation(
    @Param('id') id: string,
    @Body() body: { userId: string; title: string },
  ) {
    return this.chatbotService.renameConversation(body.userId, id, body.title);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Xóa 1 cuộc trò chuyện chatbot' })
  async deleteConversation(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    return this.chatbotService.deleteConversation(userId, id);
  }

  @Delete('conversations/:id/messages')
  @ApiOperation({ summary: 'Xóa toàn bộ tin nhắn trong cuộc trò chuyện chatbot' })
  async clearConversationMessages(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    return this.chatbotService.clearConversationMessages(userId, id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Lấy tin nhắn chatbot theo conversationId' })
  async getConversationMessages(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    return this.chatbotService.getConversationMessages(userId, id);
  }

  @Delete('conversations/:conversationId/messages/:messageId')
  @ApiOperation({ summary: 'Thu hồi (xóa) 1 tin nhắn chatbot' })
  async deleteMessage(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Query('userId') userId: string,
  ) {
    return this.chatbotService.deleteMessage(userId, conversationId, messageId);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi tin nhắn tới AI chatbot',
    description: `
      Hỗ trợ:
      - Câu hỏi về delivery / tính năng ứng dụng
      - Truy vấn thông tin bạn bè từ database (dùng userId)
      - Gửi file kèm (PDF, ảnh) để AI đọc và trả lời
    `,
  })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async chat(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.chatbotService.chat(dto);
  }

  @Post('chat/stream')
  @ApiOperation({
    summary: 'Gửi tin nhắn tới AI chatbot (streaming response)',
    description: 'Response trả về dạng Server-Sent Events (SSE)',
  })
  async chatStream(
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    try {
      const result = await this.chatbotService.chat(dto);

      // Gửi từng từ một để tạo hiệu ứng streaming
      const words = result.reply.split(' ');
      for (const word of words) {
        res.write(`data: ${JSON.stringify({ token: word + ' ' })}\n\n`);
        await new Promise((r) => setTimeout(r, 20)); // 20ms delay giữa các từ
      }

      // Gửi tools used và kết thúc
      res.write(
        `data: ${JSON.stringify({ done: true, toolsUsed: result.toolsUsed })}\n\n`,
      );
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({ error: err.message || 'Lỗi server' })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}

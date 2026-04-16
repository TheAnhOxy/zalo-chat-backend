import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { UpsertReactionDto } from './dto/upsert-reaction.dto';
import { AddSeenByDto } from './dto/add-seen-by.dto';
import { AddDeletedByDto } from './dto/add-deleted-by.dto';

@ApiTags('Messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi tin nhắn' })
  create(@Body() dto: CreateMessageDto) {
    return this.messagesService.create(dto);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Tin theo hội thoại (createdAt giảm dần)' })
  @ApiQuery({ name: 'userId', required: true, description: 'ID người dùng hiện tại để lọc tin nhắn đã xóa' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'pinned', required: false, description: 'true để chỉ lấy tin đã ghim' })
  findByConversation(
    @Param('conversationId') conversationId: string,
    @Query('userId') userId: string, // Thêm userId để truyền vào Service
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('pinned') pinned?: string,
  ) {
    // Truyền đúng 3 tham số: ID hội thoại, ID người dùng, và Object options
    return this.messagesService.findByConversation(conversationId, userId, {
      limit,
      skip,
      pinnedOnly: pinned == 'true' || pinned == '1',
    });
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'Đặt reaction (một user một loại, ghi đè cũ)' })
  upsertReaction(@Param('id') id: string, @Body() dto: UpsertReactionDto) {
    return this.messagesService.upsertReaction(id, dto.userId, dto.type);
  }

  @Post(':id/seen-by')
  @ApiOperation({ summary: 'Thêm seen cho user (ghi đè seen cũ của user đó)' })
  addSeenBy(@Param('id') id: string, @Body() dto: AddSeenByDto) {
    return this.messagesService.addSeenBy(
      id,
      dto.userId,
      dto.seenAt ? new Date(dto.seenAt) : undefined,
    );
  }

  @Post(':id/deleted-by')
  @ApiOperation({ summary: 'Ẩn tin với user (soft delete)' })
  addDeletedBy(@Param('id') id: string, @Body() dto: AddDeletedByDto) {
    return this.messagesService.addDeletedBy(id, dto.userId);
  }

  @Post('conversation/:conversationId/deleted-by')
  @ApiOperation({ summary: 'Xóa lịch sử (phía tôi) theo hội thoại' })
  deleteConversationForMe(
    @Param('conversationId') conversationId: string,
    @Body() dto: AddDeletedByDto,
  ) {
    return this.messagesService.deleteConversationForMe(conversationId, dto.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết message' })
  findOne(@Param('id') id: string) {
    return this.messagesService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cập nhật message (content, status, metadata, …)',
  })
  update(@Param('id') id: string, @Body() dto: UpdateMessageDto) {
    return this.messagesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa message' })
  remove(@Param('id') id: string) {
    return this.messagesService.remove(id);
  }
}
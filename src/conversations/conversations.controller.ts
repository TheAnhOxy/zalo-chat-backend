import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@ApiTags('Conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo hội thoại (PRIVATE / GROUP) + members embed' })
  create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách conversations' })
  findAll() {
    return this.conversationsService.findAll();
  }

  @Get('member/:userId')
  @ApiOperation({ summary: 'Conversations có user trong members' })
  findByMember(@Param('userId') userId: string) {
    return this.conversationsService.findByMemberUserId(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết conversation' })
  findOne(@Param('id') id: string) {
    return this.conversationsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cập nhật (members / lastMessage / groupSettings / …)',
  })
  update(@Param('id') id: string, @Body() dto: UpdateConversationDto) {
    return this.conversationsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa conversation' })
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(id);
  }
}

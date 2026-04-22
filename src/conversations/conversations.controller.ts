import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import * as https from 'https';
import * as http from 'http';

@ApiTags('Conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get('avatar/proxy')
  @ApiOperation({ summary: 'Proxy ảnh từ S3 về Flutter Web (tránh CORS)' })
  proxyAvatar(@Query('url') url: string, @Res() res: Response) {
    if (!url || !url.startsWith('http')) {
      throw new BadRequestException('URL không hợp lệ');
    }

    const parsed = new URL(url);
    const requester = parsed.protocol === 'https:' ? https : http;

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');

    requester
      .get(url, (stream) => {
        res.set('Content-Type', stream.headers['content-type'] || 'image/jpeg');
        stream.pipe(res);
      })
      .on('error', () => {
        res.status(502).send('Không thể tải ảnh');
      });
  }

  @Post('avatar/upload')
  @ApiOperation({ summary: 'Upload ảnh nhóm lên S3 qua backend' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadGroupAvatar(
    @UploadedFile()
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
    },
  ) {
    return this.conversationsService.uploadGroupAvatar(file);
  }

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

  @Get(':id/pinned-messages')
  @ApiOperation({ summary: 'Danh sách đầy đủ các tin nhắn đã ghim của hội thoại' })
  findPinnedMessages(@Param('id') id: string) {
    return this.conversationsService.findPinnedMessages(id);
  }

  @Get(':id/invite-link')
  @ApiOperation({ summary: 'Lấy/tạo link mời vào nhóm' })
  getInviteLink(@Param('id') id: string) {
    return this.conversationsService.getOrCreateInviteLink(id);
  }

  @Post(':id/invite-link/regenerate')
  @ApiOperation({ summary: 'Tạo mới link mời (đổi code)' })
  regenerateInviteLink(@Param('id') id: string) {
    return this.conversationsService.regenerateInviteLink(id);
  }

  @Post('join-by-link')
  @ApiOperation({ summary: 'Tham gia nhóm bằng code link' })
  joinByLink(@Body() body: { code: string; userId: string }) {
    return this.conversationsService.joinByInviteLink(body.code, body.userId);
  }

  @Get('join')
  @ApiOperation({ summary: 'Endpoint test join link (chỉ để debug trên web)' })
  joinDebug(@Query('code') code: string) {
    return { success: true, code };
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

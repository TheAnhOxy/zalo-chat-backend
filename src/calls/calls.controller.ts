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
import { CallsService } from './calls.service';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';

@ApiTags('Calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo bản ghi cuộc gọi (VOICE / VIDEO)' })
  create(@Body() dto: CreateCallDto) {
    return this.callsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách calls' })
  findAll() {
    return this.callsService.findAll();
  }

  /**
   * Cấp ICE config với TURN credentials có TTL (Time-Limited Credentials).
   *
   * Theo chuẩn TURN REST API (RFC 8489 Section 9.2):
   *   username = "<unix-timestamp-expiry>:<userId>"
   *   credential = HMAC-SHA1(TURN_SECRET, username)
   *
   * Client chỉ nhận credential tạm thời, hết hạn sau TURN_TTL_SECONDS.
   * TURN secret thật không bao giờ rời khỏi server.
   */
  @Get('ice-config')
  @ApiOperation({ summary: 'Lấy ICE servers config với TURN credentials TTL-based (1h)' })
  getIceConfig(@Query('userId') userId?: string) {
    return this.callsService.generateIceConfig(userId ?? 'anonymous');
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Calls theo hội thoại' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  findByConversation(
    @Param('conversationId') conversationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
  ) {
    return this.callsService.findByConversationId(conversationId, {
      limit,
      skip,
    });
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Calls mà user là caller hoặc participant' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  findByUser(
    @Param('userId') userId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
  ) {
    return this.callsService.findByUserId(userId, { limit, skip });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết call' })
  findOne(@Param('id') id: string) {
    return this.callsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật trạng thái / thời gian / duration' })
  update(@Param('id') id: string, @Body() dto: UpdateCallDto) {
    return this.callsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa bản ghi call' })
  remove(@Param('id') id: string) {
    return this.callsService.remove(id);
  }
}

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
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo thông báo' })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách notifications' })
  findAll() {
    return this.notificationsService.findAll();
  }

  @Get('receiver/:receiverId')
  @ApiOperation({ summary: 'Notifications của người nhận' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'unreadOnly', required: false, example: 'true' })
  findByReceiver(
    @Param('receiverId') receiverId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const unreadOnlyBool = unreadOnly === 'true' || unreadOnly === '1';
    return this.notificationsService.findByReceiverId(receiverId, {
      limit,
      skip,
      unreadOnly: unreadOnlyBool,
    });
  }

  @Patch('receiver/:receiverId/read-all')
  @ApiOperation({ summary: 'Đánh dấu đã đọc tất cả của receiver' })
  markAllRead(@Param('receiverId') receiverId: string) {
    return this.notificationsService.markAllReadForReceiver(receiverId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu đã đọc một notification' })
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết notification' })
  findOne(@Param('id') id: string) {
    return this.notificationsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật notification' })
  update(@Param('id') id: string, @Body() dto: UpdateNotificationDto) {
    return this.notificationsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa notification' })
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
}

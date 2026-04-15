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
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

@ApiTags('Sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo session (thiết bị + refresh token)' })
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách session' })
  findAll() {
    return this.sessionsService.findAll();
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Session theo userId' })
  findByUser(@Param('userId') userId: string) {
    return this.sessionsService.findByUserId(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết session' })
  findOne(@Param('id') id: string) {
    return this.sessionsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật session (vd. isActive, expiredAt)' })
  update(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.sessionsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa session' })
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(id);
  }
}

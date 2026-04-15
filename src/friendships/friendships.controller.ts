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
import { FriendshipsService } from './friendships.service';
import { CreateFriendshipDto } from './dto/create-friendship.dto';
import { UpdateFriendshipDto } from './dto/update-friendship.dto';

@ApiTags('Friendships')
@Controller('friendships')
export class FriendshipsController {
  constructor(private readonly friendshipsService: FriendshipsService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi lời mời kết bạn (status = PENDING)' })
  create(@Body() dto: CreateFriendshipDto) {
    return this.friendshipsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách friendships' })
  findAll() {
    return this.friendshipsService.findAll();
  }

  @Get('user/:userId')
  @ApiOperation({
    summary: 'Friendships liên quan user (requester hoặc addressee)',
  })
  findByUser(@Param('userId') userId: string) {
    return this.friendshipsService.findByUserId(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết friendship' })
  findOne(@Param('id') id: string) {
    return this.friendshipsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật status (ACCEPTED, BLOCKED, ...)' })
  update(@Param('id') id: string, @Body() dto: UpdateFriendshipDto) {
    return this.friendshipsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa friendship' })
  remove(@Param('id') id: string) {
    return this.friendshipsService.remove(id);
  }
}

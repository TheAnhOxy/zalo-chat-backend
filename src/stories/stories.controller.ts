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
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { AddStoryViewerDto } from './dto/add-viewer.dto';

import { StoriesGateway } from './gateways/stories.gateway';

@ApiTags('Stories')
@Controller('stories')
export class StoriesController {
  constructor(
    private readonly storiesService: StoriesService,
    private readonly storiesGateway: StoriesGateway,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Đăng story (IMAGE / VIDEO)' })
  async create(@Body() dto: CreateStoryDto) {
    const saved = await this.storiesService.create(dto);
    this.storiesGateway.broadcastNewStory(saved);
    return saved;
  }

  @Get('explore')
  @ApiOperation({ summary: 'Xem explore feed (public)' })
  @ApiQuery({ name: 'excludeUserId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findExplore(
    @Query('excludeUserId') excludeUserId?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.storiesService.findExplore(excludeUserId ?? '', limit ?? 20);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách stories (cũ)' })
  findAll() {
    return this.storiesService.findAll();
  }

  @Get('feed/:userId')
  @ApiOperation({ summary: 'Lấy danh sách story group theo Facebook/Zalo logic' })
  getStoryFeed(@Param('userId') userId: string) {
    return this.storiesService.getStoryFeed(userId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Stories theo user' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    description: 'true = chỉ story chưa hết hạn (expiresAt > now)',
  })
  findByUser(
    @Param('userId') userId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const active = activeOnly === 'true' || activeOnly === '1';
    return this.storiesService.findByUserId(userId, {
      limit,
      skip,
      activeOnly: active,
    });
  }

  @Post(':id/viewers')
  @ApiOperation({ summary: 'Ghi nhận user đã xem story' })
  addViewer(@Param('id') id: string, @Body() dto: AddStoryViewerDto) {
    return this.storiesService.addViewer(id, dto.viewerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết story' })
  findOne(@Param('id') id: string) {
    return this.storiesService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật story' })
  update(@Param('id') id: string, @Body() dto: UpdateStoryDto) {
    return this.storiesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa story' })
  remove(@Param('id') id: string) {
    return this.storiesService.remove(id);
  }
}

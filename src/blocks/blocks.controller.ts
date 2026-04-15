import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/auth/access-token.guard';
import { CurrentUserId } from '../common/auth/current-user.decorator';
import { BlocksService } from './blocks.service';

class BlockUserDto {
  userId: string;
}

@ApiTags('Blocks')
@Controller('v1/blocks')
@UseGuards(AccessTokenGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'List blocked users' })
  list(@CurrentUserId() userId: string) {
    return this.blocksService.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Block a user' })
  block(@CurrentUserId() userId: string, @Body() dto: BlockUserDto) {
    return this.blocksService.block(userId, dto.userId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Unblock a user' })
  async unblock(
    @CurrentUserId() userId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.blocksService.unblock(userId, targetUserId);
    return { success: true };
  }
}

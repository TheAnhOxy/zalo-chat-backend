import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../common/auth/access-token.guard';
import { CurrentUserId } from '../../common/auth/current-user.decorator';
import { UsersService } from '../users.service';
import { FriendshipsService } from '../../friendships/friendships.service';
import { BlocksService } from '../../blocks/blocks.service';

@ApiTags('UsersV1')
@Controller('v1/users')
@UseGuards(AccessTokenGuard)
export class UsersV1Controller {
  constructor(
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
    private readonly blocksService: BlocksService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Friend profile (auth required)' })
  getProfile(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get(':id/mutual-friends')
  @ApiOperation({ summary: 'Mutual friends between me and target user' })
  mutualFriends(
    @CurrentUserId() me: string,
    @Param('id') otherId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.usersService.getMutualFriends(me, otherId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':id/safe')
  @ApiOperation({
    summary: 'Quick relationship + block state (for profile CTA)',
  })
  async safeState(@CurrentUserId() me: string, @Param('id') otherId: string) {
    const block = await this.blocksService.getBlockDirection(me, otherId);
    if (block === 'a_blocks_b') return { status: 'blocked' };
    if (block === 'b_blocks_a') return { status: 'blocked_by_other' };
    return this.friendshipsService.getRelationship(me, otherId);
  }
}

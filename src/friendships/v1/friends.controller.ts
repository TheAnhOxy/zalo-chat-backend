import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../common/auth/access-token.guard';
import { CurrentUserId } from '../../common/auth/current-user.decorator';
import { FriendshipsService } from '../friendships.service';

@ApiTags('Friends')
@Controller('v1/friends')
@UseGuards(AccessTokenGuard)
export class FriendsController {
  constructor(private readonly friendshipsService: FriendshipsService) {}

  @Get()
  @ApiOperation({ summary: 'List friends (accepted)' })
  list(
    @CurrentUserId() me?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.friendshipsService.listFriends(String(me || ''), {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}

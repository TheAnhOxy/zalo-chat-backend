import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/auth/access-token.guard';
import { CurrentUserId } from '../common/auth/current-user.decorator';
import { SuggestedFriendsService } from './suggested.service';

@ApiTags('SuggestedFriends')
@Controller('v1/suggested-friends')
@UseGuards(AccessTokenGuard)
export class SuggestedFriendsController {
  constructor(
    private readonly suggestedFriendsService: SuggestedFriendsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Suggested friends (friends-of-friends + mutualCount)',
  })
  list(@CurrentUserId() me: string, @Query('limit') limit?: string) {
    return this.suggestedFriendsService.suggestedFriends(me, {
      limit: limit ? Number(limit) : undefined,
    });
  }
}

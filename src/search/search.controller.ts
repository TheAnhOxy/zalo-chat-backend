import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../common/auth/access-token.guard';
import { CurrentUserId } from '../common/auth/current-user.decorator';
import { SearchService } from './search.service';

@ApiTags('Search')
@Controller('v1/search')
@UseGuards(AccessTokenGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Search users for add-friend (filters blocked/friends/pending)',
  })
  users(
    @CurrentUserId() me: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.searchService.searchUsers(me, {
      q: q || '',
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }
}

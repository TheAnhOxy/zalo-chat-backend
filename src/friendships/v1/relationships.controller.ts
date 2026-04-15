import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../common/auth/access-token.guard';
import { CurrentUserId } from '../../common/auth/current-user.decorator';
import { FriendshipsService } from '../friendships.service';

@ApiTags('Relationships')
@Controller('v1/relationships')
@UseGuards(AccessTokenGuard)
export class RelationshipsController {
  constructor(private readonly friendshipsService: FriendshipsService) {}

  @Get(':userId')
  @ApiOperation({ summary: 'Get relationship status between me and userId' })
  get(@CurrentUserId() me?: string, @Param('userId') userId?: string) {
    return this.friendshipsService.getRelationship(
      String(me || ''),
      String(userId || ''),
    );
  }
}

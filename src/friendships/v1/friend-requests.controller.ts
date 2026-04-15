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
import { AccessTokenGuard } from '../../common/auth/access-token.guard';
import { CurrentUserId } from '../../common/auth/current-user.decorator';
import { FriendshipsService } from '../friendships.service';

class CreateFriendRequestDto {
  userId: string;
}

@ApiTags('FriendRequests')
@Controller('v1/friend-requests')
@UseGuards(AccessTokenGuard)
export class FriendRequestsController {
  constructor(private readonly friendshipsService: FriendshipsService) {}

  @Post()
  @ApiOperation({ summary: 'Send friend request' })
  create(@CurrentUserId() me: string, @Body() dto: CreateFriendRequestDto) {
    return this.friendshipsService.sendRequest(me, dto.userId);
  }

  @Get('inbound')
  @ApiOperation({ summary: 'List inbound friend requests' })
  inbound(@CurrentUserId() me: string) {
    return this.friendshipsService.listInboundRequests(me);
  }

  @Get('outbound')
  @ApiOperation({ summary: 'List outbound friend requests' })
  outbound(@CurrentUserId() me: string) {
    return this.friendshipsService.listOutboundRequests(me);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept friend request' })
  accept(@CurrentUserId() me: string, @Param('id') id: string) {
    return this.friendshipsService.acceptRequest(me, id);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline friend request' })
  decline(@CurrentUserId() me: string, @Param('id') id: string) {
    return this.friendshipsService.declineRequest(me, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel outbound friend request' })
  async cancel(@CurrentUserId() me: string, @Param('id') id: string) {
    await this.friendshipsService.cancelRequest(me, id);
    return { success: true };
  }
}

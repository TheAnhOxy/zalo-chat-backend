import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FriendshipStatus } from '../schemas/friendship.schema';

export class UpdateFriendshipDto {
  @ApiProperty({ enum: FriendshipStatus })
  @IsEnum(FriendshipStatus)
  status: FriendshipStatus;
}

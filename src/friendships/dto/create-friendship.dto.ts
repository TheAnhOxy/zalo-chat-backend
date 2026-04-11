import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFriendshipDto {
  @ApiProperty({ description: 'User gửi lời mời' })
  @IsMongoId()
  requesterId: string;

  @ApiProperty({ description: 'User nhận lời mời' })
  @IsMongoId()
  addresseeId: string;
}

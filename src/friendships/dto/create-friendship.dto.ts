import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFriendshipDto {
  @ApiProperty({ description: 'User gửi lời mời' })
  @IsMongoId()
  requesterId: string;

  @ApiProperty({ description: 'User nhận lời mời' })
  @IsMongoId()
  addresseeId: string;

  @ApiPropertyOptional({ description: 'Lời nhắn kèm lời mời (tùy chọn)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

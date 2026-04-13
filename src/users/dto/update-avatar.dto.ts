import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class UpdateAvatarDto {
  @ApiProperty({ example: 'https://cdn-or-s3-public-url/avatar.jpg' })
  @IsUrl({ require_tld: false })
  avatar: string;
}

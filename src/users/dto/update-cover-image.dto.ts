import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class UpdateCoverImageDto {
  @ApiProperty({ example: 'https://cdn-or-s3-public-url/cover.jpg' })
  @IsUrl({ require_tld: false })
  coverImage: string;
}

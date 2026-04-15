import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class AvatarPresignDto {
  @ApiProperty({ example: 'avatar.jpg' })
  @IsString()
  @MaxLength(200)
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @Matches(/^image\/[a-zA-Z0-9.+-]+$/, {
    message: 'contentType must be a valid image MIME type',
  })
  contentType: string;
}

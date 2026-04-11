import { IsMongoId, IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LastMessageDto {
  @ApiPropertyOptional({ description: 'ObjectId document messages' })
  @IsOptional()
  @IsMongoId()
  messageId?: string;

  @ApiProperty()
  @IsString()
  content: string;

  @ApiProperty()
  @IsMongoId()
  senderId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdAt?: string;
}

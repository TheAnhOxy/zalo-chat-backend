import { IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  senderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  messageId?: string;
}

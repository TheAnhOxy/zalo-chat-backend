import {
  IsMongoId,
  IsEnum,
  IsString,
  IsBoolean,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationMemberRole } from '../schemas/conversation.schema';

export class ConversationMemberDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional({ enum: ConversationMemberRole })
  @IsOptional()
  @IsEnum(ConversationMemberRole)
  role?: ConversationMemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hiddenPin?: string;
}

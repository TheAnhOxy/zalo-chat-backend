import {
  IsEnum,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationType } from '../schemas/conversation.schema';
import { ConversationMemberDto } from './conversation-member.dto';
import { LastMessageDto } from './last-message.dto';
import { GroupSettingsDto } from './group-settings.dto';

export class CreateConversationDto {
  @ApiProperty({ enum: ConversationType })
  @IsEnum(ConversationType)
  type: ConversationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiProperty({ type: [ConversationMemberDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConversationMemberDto)
  members: ConversationMemberDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LastMessageDto)
  lastMessage?: LastMessageDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GroupSettingsDto)
  groupSettings?: GroupSettingsDto;
}

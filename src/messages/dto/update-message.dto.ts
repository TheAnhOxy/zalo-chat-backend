import {
  IsEnum,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsObject,
  IsMongoId,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType, MessageStatus } from '../schemas/message.schema';
import { MessageMetadataDto } from './message-metadata.dto';
import { MessageReactionDto } from './message-reaction.dto';
import { MessageSeenByDto } from './message-seen-by.dto';

export class UpdateMessageDto {
  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MessageMetadataDto)
  metadata?: MessageMetadataDto;

  @ApiPropertyOptional({ description: 'null để bỏ reply' })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsMongoId()
  replyTo?: string | null;

  @ApiPropertyOptional({ enum: MessageStatus })
  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRecalled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  deletedBy?: string[];

  @ApiPropertyOptional({ type: [MessageReactionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageReactionDto)
  reactions?: MessageReactionDto[];

  @ApiPropertyOptional({ type: [MessageSeenByDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageSeenByDto)
  seenBy?: MessageSeenByDto[];
}

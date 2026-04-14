import {
  IsMongoId,
  IsEnum,
  IsArray,
  IsOptional,
  IsDateString,
  IsNumber,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallType, CallStatus } from '../schemas/call.schema';

export class CreateCallDto {
  @ApiProperty()
  @IsMongoId()
  conversationId: string;

  @ApiProperty()
  @IsMongoId()
  callerId: string;

  @ApiProperty({ type: [String], description: 'ObjectId các user tham gia' })
  @IsArray()
  @ArrayMinSize(0)
  @IsMongoId({ each: true })
  participants: string[];

  @ApiPropertyOptional()
@IsOptional()
callerName?: string;

@ApiPropertyOptional()
@IsOptional()
callerAvatar?: string;

  @ApiProperty({ enum: CallType })
  @IsEnum(CallType)
  type: CallType;

  @ApiPropertyOptional({ enum: CallStatus })
  @IsOptional()
  @IsEnum(CallStatus)
  status?: CallStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  duration?: number;
}

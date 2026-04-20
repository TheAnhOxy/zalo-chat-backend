import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsNumber,
  IsArray,
  IsMongoId,
  ArrayMinSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CallType, CallStatus } from '../schemas/call.schema';

export class UpdateCallDto {
  @ApiPropertyOptional({ enum: CallType })
  @IsOptional()
  @IsEnum(CallType)
  type?: CallType;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsMongoId({ each: true })
  participants?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsMongoId({ each: true })
  activeParticipants?: string[];
}

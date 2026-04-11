import {
  IsEnum,
  IsString,
  IsOptional,
  IsDateString,
  IsArray,
  IsMongoId,
  ArrayMinSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StoryMediaType } from '../schemas/story.schema';

export class UpdateStoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: StoryMediaType })
  @IsOptional()
  @IsEnum(StoryMediaType)
  type?: StoryMediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsMongoId({ each: true })
  viewers?: string[];
}

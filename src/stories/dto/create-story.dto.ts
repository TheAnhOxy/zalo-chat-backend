import {
  IsMongoId,
  IsEnum,
  IsString,
  IsOptional,
  IsDateString,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryMediaType } from '../schemas/story.schema';

export class CreateStoryDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiProperty({ example: 'https://cdn.example.com/story/1.jpg' })
  @IsString()
  mediaUrl: string;

  @ApiProperty({ enum: StoryMediaType })
  @IsEnum(StoryMediaType)
  type: StoryMediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiProperty({ example: '2026-04-12T12:00:00.000Z' })
  @IsDateString()
  expiresAt: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsMongoId({ each: true })
  viewers?: string[];
}

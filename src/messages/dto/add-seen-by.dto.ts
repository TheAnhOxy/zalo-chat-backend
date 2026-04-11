import { IsMongoId, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddSeenByDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  seenAt?: string;
}

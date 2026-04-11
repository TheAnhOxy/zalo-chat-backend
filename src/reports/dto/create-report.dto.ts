import { IsMongoId, IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus } from '../schemas/report.schema';

export class CreateReportDto {
  @ApiProperty()
  @IsMongoId()
  reporterId: string;

  @ApiProperty()
  @IsMongoId()
  targetUserId: string;

  @ApiProperty({ example: 'Spam / Quấy rối' })
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

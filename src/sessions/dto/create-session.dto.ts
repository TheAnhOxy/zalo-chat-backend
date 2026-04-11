import {
  IsString,
  IsEnum,
  IsMongoId,
  IsDateString,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionDevice } from '../schemas/session.schema';

export class CreateSessionDto {
  @ApiProperty({ description: 'ObjectId user trong collection users' })
  @IsMongoId()
  userId: string;

  @ApiProperty({ enum: SessionDevice })
  @IsEnum(SessionDevice)
  device: SessionDevice;

  @ApiProperty({ example: 'Chrome Windows' })
  @IsString()
  deviceName: string;

  @ApiProperty({ example: '192.168.1.1' })
  @IsString()
  ip: string;

  @ApiProperty({ description: 'Refresh token (JWT hoặc opaque string)' })
  @IsString()
  refreshToken: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  expiredAt: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

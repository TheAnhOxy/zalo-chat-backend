import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SessionDevice } from '../../sessions/schemas/session.schema';

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from frontend' })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({ enum: SessionDevice, default: SessionDevice.WEB })
  @IsOptional()
  @IsEnum(SessionDevice)
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  device?: SessionDevice;

  @ApiPropertyOptional({ example: 'Chrome Windows' })
  @IsOptional()
  @IsString()
  deviceName?: string;
}

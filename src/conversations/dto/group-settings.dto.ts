import { IsBoolean, IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GroupSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowInviteLink?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  joinQrCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLockChat?: boolean;
}

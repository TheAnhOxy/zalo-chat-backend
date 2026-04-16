import {
  IsBoolean,
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
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

  // ── Group chat background ────────────────────────────────────────────────
  @ApiPropertyOptional({ enum: ['PRESET', 'CUSTOM'] })
  @IsOptional()
  @IsIn(['PRESET', 'CUSTOM'])
  chatBackgroundType?: 'PRESET' | 'CUSTOM';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  chatBackgroundIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chatBackgroundCustomBase64?: string;
}

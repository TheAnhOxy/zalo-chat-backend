import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PrivacyShowPhone } from '../schemas/user.schema';

export class UpdateUserPrivacyDto {
  @ApiPropertyOptional({ enum: PrivacyShowPhone })
  @IsOptional()
  @IsEnum(PrivacyShowPhone)
  showPhone?: PrivacyShowPhone;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowStrangerMessage?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  findByPhone?: boolean;
}

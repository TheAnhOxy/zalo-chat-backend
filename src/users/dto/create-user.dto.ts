import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrivacyShowPhone, UserGender } from '../schemas/user.schema';

class UserStatusDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  lastSeen?: string;
}

class UserPrivacyDto {
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

class UserSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  darkMode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  twoFactorAuth?: boolean;
}

export class CreateUserDto {
  @ApiProperty({ example: '0901234567' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'matKhau123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  fullName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({ enum: UserGender })
  @IsOptional()
  @IsEnum(UserGender)
  gender?: UserGender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UserStatusDto)
  status?: UserStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UserPrivacyDto)
  privacy?: UserPrivacyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UserSettingsDto)
  settings?: UserSettingsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fcmTokens?: string[];
}

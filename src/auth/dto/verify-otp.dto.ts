import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: 'OTP_1712911111111_1234' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ example: '123456' })
  @Transform(({ value }) => String(value ?? '').trim())
  @Matches(/^\d{6}$/)
  otp: string;
}

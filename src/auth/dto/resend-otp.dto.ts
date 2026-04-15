import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({ example: 'OTP_1712912222222_5678' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;
}

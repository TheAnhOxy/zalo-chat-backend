import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ForgotPasswordRequestOtpDto {
  @ApiProperty({ example: 'example@gmail.com' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'NewPass@123' })
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

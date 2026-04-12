import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: '665f5a7bc2d6a5e2f4d7f7aa' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 'OldPass@123' })
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @ApiProperty({ example: 'NewPass@123' })
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

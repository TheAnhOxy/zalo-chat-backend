import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginChallengeStatusDto {
  @ApiProperty({ example: 'LC_1712911111111_1234' })
  @IsString()
  @IsNotEmpty()
  challengeId: string;
}

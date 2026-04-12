import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutAllDto {
  @ApiPropertyOptional({ example: '665f5a7bc2d6a5e2f4d7f7aa' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: 'jwt-refresh-token' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddDeletedByDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;
}

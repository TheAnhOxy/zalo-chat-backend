import { IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddStoryViewerDto {
  @ApiProperty()
  @IsMongoId()
  viewerId: string;
}

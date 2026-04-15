import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { BlocksModule } from '../blocks/blocks.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [UsersModule, FriendshipsModule, BlocksModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}

import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { FriendshipsModule } from '../friendships/friendships.module';
import { BlocksModule } from '../blocks/blocks.module';
import { SuggestedFriendsController } from './suggested.controller';
import { SuggestedFriendsService } from './suggested.service';

@Module({
  imports: [UsersModule, FriendshipsModule, BlocksModule],
  controllers: [SuggestedFriendsController],
  providers: [SuggestedFriendsService],
})
export class SuggestedModule {}

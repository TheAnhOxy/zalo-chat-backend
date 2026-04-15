import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Friendship, FriendshipSchema } from './schemas/friendship.schema';
import { FriendshipsService } from './friendships.service';
import { FriendshipsController } from './friendships.controller';
import { BlocksModule } from '../blocks/blocks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FriendRequestsController } from './v1/friend-requests.controller';
import { FriendsController } from './v1/friends.controller';
import { RelationshipsController } from './v1/relationships.controller';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BlocksModule,
    NotificationsModule,
  ],
  controllers: [
    FriendshipsController,
    FriendRequestsController,
    FriendsController,
    RelationshipsController,
  ],
  providers: [FriendshipsService],
  exports: [FriendshipsService, MongooseModule],
})
export class FriendshipsModule {}

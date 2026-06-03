import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Story, StorySchema } from './schemas/story.schema';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';

import { FriendshipsModule } from '../friendships/friendships.module';
import { StoriesGateway } from './gateways/stories.gateway';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Story.name, schema: StorySchema }]),
    FriendshipsModule,
    NotificationsModule,
  ],
  controllers: [StoriesController],
  providers: [StoriesService, StoriesGateway],
  exports: [StoriesService, MongooseModule],
})
export class StoriesModule {}

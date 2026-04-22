import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { StoriesService } from '../stories.service';
import { FriendshipsService } from '../../friendships/friendships.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket'],
})
export class StoriesGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('StoriesGateway');

  constructor(
    private readonly storiesService: StoriesService,
    private readonly friendshipsService: FriendshipsService,
  ) {}

  // Broadcast function to be called from REST Controller after a story is created
  async broadcastNewStory(story: any) {
    try {
      const creatorId = story.userId.toString();
      // Lấy danh sách ID bạn bè
      const friendIds = await this.friendshipsService.findAcceptedFriendIdsByUserId(creatorId);

      // Gửi sự kiện 'new_story' tới chính người tạo và tới bạn bè
      const recipients = [creatorId, ...friendIds];
      for (const userId of recipients) {
        this.server.to(userId).emit('new_story', story);
      }
      this.logger.log(`Broadcasted new_story from user ${creatorId} to ${friendIds.length} friends`);
    } catch (e) {
      this.logger.error('Error broadcasting new story', e);
    }
  }

  @SubscribeMessage('view_story')
  async handleViewStory(
    @MessageBody() data: { storyId: string; creatorId: string; viewerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { storyId, creatorId, viewerId } = data;
      if (!storyId || !creatorId || !viewerId) return;

      // Cập nhật vào DB
      const updatedStory = await this.storiesService.addViewer(storyId, viewerId);

      // Emit ngược lại cho creator biết
      // 'story_seen' cho creator
      this.server.to(creatorId).emit('story_seen', {
        storyId,
        viewerId,
        updatedStory,
      });
      
    } catch (e) {
      this.logger.error('Error in view_story: ', e);
    }
  }
}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { FriendshipsModule } from '../friendships/friendships.module';
import { BlocksModule } from '../blocks/blocks.module';
import { UsersV1Controller } from './v1/users.v1.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    FriendshipsModule,
    BlocksModule,
  ],
  controllers: [UsersController, UsersV1Controller],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserPrivacyDto } from './dto/update-user-privacy.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AvatarPresignDto } from './dto/avatar-presign.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Đăng ký / tạo user (MongoDB)' })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách user' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Lấy profile user đầy đủ theo schema users' })
  getUserProfile(@Param('userId') userId: string) {
    return this.usersService.findById(userId);
  }

  @Put(':userId')
  @ApiOperation({ summary: 'Cập nhật profile user' })
  updateProfile(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch(':userId/privacy')
  @ApiOperation({ summary: 'Cập nhật privacy user' })
  updatePrivacy(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPrivacyDto,
  ) {
    return this.usersService.updatePrivacy(userId, dto);
  }

  @Patch(':userId/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái hoạt động user' })
  updateStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(userId, dto);
  }

  @Post(':userId/avatar/presign')
  @ApiOperation({ summary: 'Xin presigned URL upload avatar lên S3' })
  createAvatarPresignedUrl(
    @Param('userId') userId: string,
    @Body() dto: AvatarPresignDto,
  ) {
    return this.usersService.createAvatarPresignedUrl(userId, dto);
  }

  @Patch(':userId/avatar')
  @ApiOperation({ summary: 'Cập nhật avatar sau khi upload thành công' })
  updateAvatar(
    @Param('userId') userId: string,
    @Body() dto: UpdateAvatarDto,
  ) {
    return this.usersService.updateAvatar(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật user' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa user' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}

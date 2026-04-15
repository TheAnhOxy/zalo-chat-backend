import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserPrivacyDto } from './dto/update-user-privacy.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AvatarPresignDto } from './dto/avatar-presign.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateCoverImageDto } from './dto/update-cover-image.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateUserDto): Promise<Record<string, unknown>> {
    const emailTaken = await this.userModel.exists({
      email: dto.email.toLowerCase(),
    });
    if (emailTaken) {
      throw new ConflictException('Email đã được sử dụng');
    }
    const phoneTaken = await this.userModel.exists({ phone: dto.phone });
    if (phoneTaken) {
      throw new ConflictException('Số điện thoại đã được sử dụng');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const doc = new this.userModel({
      ...dto,
      password: hashed,
      email: dto.email.toLowerCase(),
      dob: dto.dob ? new Date(dto.dob) : null,
    });

    if (dto.status?.lastSeen) {
      doc.status.lastSeen = new Date(dto.status.lastSeen);
    }
    if (dto.status?.isOnline !== undefined) {
      doc.status.isOnline = dto.status.isOnline;
    }

    const saved = await doc.save();
    return this.toPublic(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.userModel.find().exec();
    return list.map((u) => this.toPublic(u));
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    const user = await this.findDocById(id);
    return this.toPublic(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.findDocById(userId);

    if (dto.email !== undefined) {
      throw new BadRequestException('email cannot be updated');
    }

    if (dto.phone !== undefined) {
      throw new BadRequestException('phone cannot be updated');
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.bio !== undefined) user.bio = dto.bio;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.avatar !== undefined) user.avatar = dto.avatar;
    if (dto.coverImage !== undefined) user.coverImage = dto.coverImage;
    if (dto.isBlocked !== undefined) user.isBlocked = dto.isBlocked;
    if (dto.dob !== undefined) user.dob = dto.dob ? new Date(dto.dob) : null;

    await user.save();
    return this.toPublic(user);
  }

  async updatePrivacy(
    userId: string,
    dto: UpdateUserPrivacyDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.findDocById(userId);
    Object.assign(user.privacy, dto);
    await user.save();
    return this.toPublic(user);
  }

  async updateStatus(
    userId: string,
    dto: UpdateUserStatusDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.findDocById(userId);
    user.status.isOnline = dto.isOnline;
    user.status.lastSeen = dto.isOnline ? null : new Date();
    await user.save();
    return this.toPublic(user);
  }

  async createAvatarPresignedUrl(
    userId: string,
    dto: AvatarPresignDto,
  ): Promise<Record<string, string>> {
    await this.findDocById(userId);

    return this.createPresignedUrlForImage({
      userId,
      folder: 'avatars',
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async createCoverPresignedUrl(
    userId: string,
    dto: AvatarPresignDto,
  ): Promise<Record<string, string>> {
    await this.findDocById(userId);

    return this.createPresignedUrlForImage({
      userId,
      folder: 'covers',
      fileName: dto.fileName,
      contentType: dto.contentType,
    });
  }

  async updateCoverImage(
    userId: string,
    dto: UpdateCoverImageDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.findDocById(userId);
    user.coverImage = dto.coverImage;
    await user.save();
    return this.toPublic(user);
  }

  private async createPresignedUrlForImage(params: {
    userId: string;
    folder: 'avatars' | 'covers';
    fileName: string;
    contentType: string;
  }): Promise<Record<string, string>> {
    const { userId, folder, fileName, contentType } = params;

    const region = this.configService.get<string>('S3_REGION');
    const bucket = this.configService.get<string>('S3_BUCKET_NAME');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'Missing S3 configuration. Please set S3_REGION, S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY',
      );
    }

    const safeFileName = fileName
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');

    const objectKey = `${folder}/${userId}/${Date.now()}-${safeFileName}`;
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });
    const fileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;

    return { uploadUrl, fileUrl };
  }

  async updateAvatar(
    userId: string,
    dto: UpdateAvatarDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.findDocById(userId);
    user.avatar = dto.avatar;
    await user.save();
    return this.toPublic(user);
  }

  /** Đăng nhập — có kèm password */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .exec();
  }

  async findByEmail(email: string): Promise<Record<string, unknown> | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    return user ? this.toPublic(user) : null;
  }

  async findByPhone(phone: string): Promise<Record<string, unknown> | null> {
    // Chuẩn hóa để tìm cả 2 định dạng: 0xxx và +84xxx
    const variants = new Set<string>([phone]);

    if (phone.startsWith('+84')) {
      variants.add('0' + phone.slice(3));
    } else if (phone.startsWith('0')) {
      variants.add('+84' + phone.slice(1));
    }

    const user = await this.userModel
      .findOne({ phone: { $in: Array.from(variants) } })
      .exec();
    return user ? this.toPublic(user) : null;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
  ): Promise<Record<string, unknown>> {
    const doc = await this.userModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const {
      status,
      privacy,
      settings,
      dob,
      email,
      fcmTokens,
      ...scalar
    } = dto;

    Object.assign(doc, scalar);
    if (email !== undefined) doc.email = email.toLowerCase();
    if (dob !== undefined) doc.dob = dob ? new Date(dob) : null;
    if (fcmTokens !== undefined) doc.fcmTokens = fcmTokens;
    if (status) {
      if (status.isOnline !== undefined) {
        doc.status.isOnline = status.isOnline;
      }
      if (status.lastSeen !== undefined) {
        doc.status.lastSeen = status.lastSeen
          ? new Date(status.lastSeen)
          : null;
      }
    }
    if (privacy) Object.assign(doc.privacy, privacy);
    if (settings) Object.assign(doc.settings, settings);

    await doc.save();
    return this.toPublic(doc);
  }

  async addFcmToken(userId: string, token: string): Promise<Record<string, unknown>> {
    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { fcmTokens: token },
    });
    return this.findById(userId);
  }

  async removeFcmToken(
    userId: string,
    token: string,
  ): Promise<Record<string, unknown>> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { fcmTokens: token },
    });
    return this.findById(userId);
  }

  async remove(id: string): Promise<void> {
    const res = await this.userModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
  }
  async getActiveFriends(userId: string) {
  // 1. Tìm danh sách bạn bè của user này (giả sử bạn có bảng friendships)
  // 2. Lọc những người có status.isOnline = true
  // 3. Kiểm tra privacy.showOnline = true (Rất quan trọng vì Schema của bạn có trường này)
  
  return await this.userModel.find({
    'status.isOnline': true,
    'privacy.showOnline': true,
    isBlocked: false,
    // Thêm điều kiện thuộc danh sách bạn bè ở đây
  }).select('fullName avatar status');
}
  // src/users/users.service.ts
  async updateStatus2(userId: string, statusData: { isOnline: boolean; lastSeen: Date }) {
   return await this.userModel.findByIdAndUpdate(
      userId,
      {
       $set: {
        'status.isOnline': statusData.isOnline,
        'status.lastSeen': statusData.lastSeen,
        },
      },
      { new: true },
    );
  }

  private async findDocById(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  private toPublic(doc: UserDocument): Record<string, unknown> {
    const o = doc.toObject({ virtuals: true });
    const { password: _pwd, ...rest } = o;
    return rest as Record<string, unknown>;
  }
}

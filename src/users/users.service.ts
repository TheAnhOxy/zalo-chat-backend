import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
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
    const user = await this.userModel.findOne({ phone }).exec();
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

  private toPublic(doc: UserDocument): Record<string, unknown> {
    const o = doc.toObject({ virtuals: true });
    const { password: _pwd, ...rest } = o;
    return rest as Record<string, unknown>;
  }
}

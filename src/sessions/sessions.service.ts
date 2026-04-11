import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from './schemas/session.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  async create(dto: CreateSessionDto): Promise<Record<string, unknown>> {
    const exists = await this.sessionModel.exists({
      refreshToken: dto.refreshToken,
    });
    if (exists) {
      throw new ConflictException('refreshToken đã tồn tại');
    }

    const doc = new this.sessionModel({
      userId: new Types.ObjectId(dto.userId),
      device: dto.device,
      deviceName: dto.deviceName,
      ip: dto.ip,
      refreshToken: dto.refreshToken,
      expiredAt: new Date(dto.expiredAt),
      isActive: dto.isActive ?? true,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.sessionModel.find().lean().exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy session');
    }
    const s = await this.sessionModel.findById(id).lean().exec();
    if (!s) {
      throw new NotFoundException('Không tìm thấy session');
    }
    return s as Record<string, unknown>;
  }

  async findByUserId(userId: string): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const list = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  /** Tra cứu khi refresh access token */
  async findActiveByRefreshToken(
    refreshToken: string,
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOne({
        refreshToken,
        isActive: true,
        expiredAt: { $gt: new Date() },
      })
      .exec();
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    await this.sessionModel.updateOne(
      { refreshToken },
      { $set: { isActive: false } },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    await this.sessionModel.updateMany(
      { userId: new Types.ObjectId(userId), isActive: true },
      { $set: { isActive: false } },
    );
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
  ): Promise<Record<string, unknown>> {
    await this.findById(id);

    const update: Record<string, unknown> = { ...dto };
    if (dto.expiredAt !== undefined) {
      update.expiredAt = new Date(dto.expiredAt);
    }

    const s = await this.sessionModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .lean()
      .exec();

    if (!s) {
      throw new NotFoundException('Không tìm thấy session');
    }
    return s as Record<string, unknown>;
  }

  async remove(id: string): Promise<void> {
    const res = await this.sessionModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy session');
    }
  }
}

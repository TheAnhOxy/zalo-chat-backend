import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Call, CallDocument, CallStatus } from './schemas/call.schema';
import { CreateCallDto } from './dto/create-call.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class CallsService {
  constructor(
    @InjectModel(Call.name) private callModel: Model<CallDocument>,
  ) {}

  async create(dto: CreateCallDto): Promise<Record<string, unknown>> {
    const doc = new this.callModel({
      conversationId: new Types.ObjectId(dto.conversationId),
      callerId: new Types.ObjectId(dto.callerId),
      participants: dto.participants.map((id) => new Types.ObjectId(id)),
      type: dto.type,
      status: dto.status ?? CallStatus.CALLING,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
      duration: dto.duration ?? 0,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.callModel.find().sort({ createdAt: -1 }).lean().exec();
    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy call');
    }
    const row = await this.callModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy call');
    }
    return row as Record<string, unknown>;
  }

  async findByConversationId(
    conversationId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      return [];
    }
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.callModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    const uid = new Types.ObjectId(userId);
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.callModel
      .find({
        $or: [{ callerId: uid }, { participants: uid }],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async update(id: string, dto: UpdateCallDto): Promise<Record<string, unknown>> {
    const doc = await this.callModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy call');
    }

    if (dto.type !== undefined) doc.type = dto.type;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.startedAt !== undefined) {
      doc.startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    }
    if (dto.endedAt !== undefined) {
      doc.endedAt = dto.endedAt ? new Date(dto.endedAt) : null;
    }
    if (dto.duration !== undefined) doc.duration = dto.duration;
    if (dto.participants !== undefined) {
      doc.participants = dto.participants.map((x) => new Types.ObjectId(x));
    }

    await doc.save();
    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.callModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy call');
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Report, ReportDocument, ReportStatus } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { toPlainDoc } from '../common/mongo-plain';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<ReportDocument>,
  ) {}

  async create(dto: CreateReportDto): Promise<Record<string, unknown>> {
    const doc = new this.reportModel({
      reporterId: new Types.ObjectId(dto.reporterId),
      targetUserId: new Types.ObjectId(dto.targetUserId),
      reason: dto.reason,
      description: dto.description ?? '',
      status: dto.status ?? ReportStatus.PENDING,
    });

    const saved = await doc.save();
    return toPlainDoc(saved);
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const list = await this.reportModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return list as Record<string, unknown>[];
  }

  async findByStatus(
    status: ReportStatus,
    options?: { limit?: number; skip?: number },
  ): Promise<Record<string, unknown>[]> {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const skip = Math.max(options?.skip ?? 0, 0);

    const list = await this.reportModel
      .find({ status })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return list as Record<string, unknown>[];
  }

  async findById(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy report');
    }
    const row = await this.reportModel.findById(id).lean().exec();
    if (!row) {
      throw new NotFoundException('Không tìm thấy report');
    }
    return row as Record<string, unknown>;
  }

  async update(id: string, dto: UpdateReportDto): Promise<Record<string, unknown>> {
    const doc = await this.reportModel.findById(id);
    if (!doc) {
      throw new NotFoundException('Không tìm thấy report');
    }

    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.reason !== undefined) doc.reason = dto.reason;
    if (dto.description !== undefined) doc.description = dto.description;

    await doc.save();
    return toPlainDoc(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.reportModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy report');
    }
  }
}

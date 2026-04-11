import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportStatus } from './schemas/report.schema';

@ApiTags('Reports (Admin)')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi báo cáo user (mặc định PENDING)' })
  create(@Body() dto: CreateReportDto) {
    return this.reportsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách báo cáo (admin)' })
  findAll() {
    return this.reportsService.findAll();
  }

  @Get('status/:status')
  @ApiOperation({ summary: 'Lọc theo PENDING | RESOLVED' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'skip', required: false })
  findByStatus(
    @Param('status', new ParseEnumPipe(ReportStatus)) status: ReportStatus,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
  ) {
    return this.reportsService.findByStatus(status, { limit, skip });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết report' })
  findOne(@Param('id') id: string) {
    return this.reportsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật (thường dùng để RESOLVED)' })
  update(@Param('id') id: string, @Body() dto: UpdateReportDto) {
    return this.reportsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa report' })
  remove(@Param('id') id: string) {
    return this.reportsService.remove(id);
  }
}

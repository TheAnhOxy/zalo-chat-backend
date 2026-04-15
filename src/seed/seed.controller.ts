import { Controller, Post, ForbiddenException, HttpCode } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SeedService } from './seed.service';

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(
    private readonly seedService: SeedService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Chạy seed (xóa & tạo lại dữ liệu mẫu)',
    description:
      'Mặc định tắt khi NODE_ENV=production (trừ khi đặt SEED_HTTP=true).',
  })
  @ApiResponse({ status: 200, description: 'Seed thành công' })
  @ApiResponse({ status: 403, description: 'Bị chặn trên production' })
  async run(): Promise<{ ok: true; message: string }> {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const allowHttp = this.configService.get<string>('SEED_HTTP') === 'true';
    if (isProd && !allowHttp) {
      throw new ForbiddenException(
        'Seed qua HTTP bị tắt trên production. Đặt SEED_HTTP=true nếu thật sự cần.',
      );
    }
    await this.seedService.run();
    return { ok: true, message: 'Đã chạy seed (xem log server).' };
  }
}

import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { UploadService } from './upload.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('upload')
export class UploadController {
  private readonly allowedAudioContentTypes = new Set([
    'audio/mpeg',
    'audio/m4a',
    'audio/mp4',
  ]);

  constructor(private readonly uploadService: UploadService) {}

//   @UseGuards(JwtAuthGuard) // Chỉ cho phép user đã đăng nhập lấy URL upload
  @Get('presigned-url')
  async getPresignedUrl(
    @Query('fileName') fileName: string,
    @Query('contentType') contentType?: string,
  ) {
    if (!fileName) {
      throw new BadRequestException('Thiếu fileName');
    }

    const normalizedContentType = contentType?.trim();
    if (normalizedContentType && !this.allowedAudioContentTypes.has(normalizedContentType)) {
      throw new BadRequestException(
        'contentType không hợp lệ. Chỉ hỗ trợ audio/mpeg, audio/m4a, audio/mp4.',
      );
    }

    // Gọi service để lấy URL tạm thời (PUT) và URL truy cập file sau khi upload (GET)
    return await this.uploadService.getPresignedUrl(fileName, normalizedContentType);
  }
}
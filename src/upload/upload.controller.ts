import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { UploadService } from './upload.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('upload')
export class UploadController {
  private readonly allowedContentTypes = new Set([
    // audio
    'audio/mpeg',
    'audio/m4a',
    'audio/mp4',
    // images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    // video
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/avi',
    // documents / text
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // fallback
    'application/octet-stream',
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

    const normalizedContentType = contentType?.trim().toLowerCase();
    if (
      normalizedContentType &&
      !this.allowedContentTypes.has(normalizedContentType)
    ) {
      throw new BadRequestException(
        'contentType không hợp lệ. Vui lòng dùng một MIME type được hỗ trợ.',
      );
    }

    // Gọi service để lấy URL tạm thời (PUT) và URL truy cập file sau khi upload (GET)
    return await this.uploadService.getPresignedUrl(
      fileName,
      normalizedContentType,
    );
  }

  @Get('presigned-download-url')
  async getPresignedDownloadUrl(
    @Query('url') url: string,
    @Query('name') name?: string,
  ) {
    if (!url) throw new BadRequestException('Thiếu url');
    return await this.uploadService.getPresignedDownloadUrl(url, name);
  }
}

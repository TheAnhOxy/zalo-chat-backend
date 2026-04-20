import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'ap-southeast-1', 
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '', 
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async getPresignedUrl(fileName: string, contentType?: string) {
    const key = `uploads/${Date.now()}-${fileName}`;
    const resolvedContentType = this.resolveContentType(fileName, contentType);
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      ContentType: resolvedContentType,
      ChecksumAlgorithm: undefined,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    
    // Lưu ý: Sửa lại File URL để khớp với Region của bạn
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
    
    return { url, fileUrl };
  }

  tryParseS3Url(url: string): { bucket: string; key: string } | null {
    try {
      const u = new URL(url);
      const host = u.hostname;
      const m = host.match(
        /^([a-z0-9.-]+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
      );
      if (!m) return null;
      const bucket = m[1];
      const key = u.pathname.replace(/^\/+/, '');
      if (!bucket || !key) return null;
      return { bucket, key };
    } catch {
      return null;
    }
  }

  async getPresignedDownloadUrl(
    fileUrl: string,
    downloadName?: string,
  ): Promise<{ url: string }> {
    const loc = this.tryParseS3Url(fileUrl);
    if (!loc) {
      // Nếu không phải S3 URL chuẩn, trả thẳng (client sẽ tự xử lý)
      return { url: fileUrl };
    }

    const command = new GetObjectCommand({
      Bucket: loc.bucket,
      Key: loc.key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName}"`
        : undefined,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    return { url };
  }

  private resolveContentType(fileName: string, contentType?: string): string {
    const trimmedContentType = contentType?.trim();
    if (trimmedContentType) {
      return trimmedContentType;
    }

    return 'application/octet-stream';
  }
}
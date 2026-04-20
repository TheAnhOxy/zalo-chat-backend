import { BadRequestException, Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly allowedAudioContentTypes = new Set([
    'audio/mpeg',
    'audio/m4a',
    'audio/mp4',
  ]);

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

  private resolveContentType(fileName: string, contentType?: string): string {
    const trimmedContentType = contentType?.trim();
    if (trimmedContentType) {
      if (this.allowedAudioContentTypes.has(trimmedContentType)) {
        return trimmedContentType;
      }

      throw new BadRequestException(
        'Unsupported contentType. Only audio/mpeg, audio/m4a, and audio/mp4 are allowed for voice uploads.',
      );
    }

    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.endsWith('.mp3')) {
      return 'audio/mpeg';
    }
    if (lowerFileName.endsWith('.m4a')) {
      return 'audio/m4a';
    }

    return 'application/octet-stream';
  }
}
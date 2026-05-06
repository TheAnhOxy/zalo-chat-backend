import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
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

    const buildCandidates = (key: string): string[] => {
      const out = new Set<string>();
      const raw = key.trim();
      if (raw) out.add(raw);
      try {
        const decoded = decodeURIComponent(raw);
        if (decoded) out.add(decoded);
      } catch {
        // ignore decode errors
      }

      const removeDupSuffix = (k: string): string =>
        k.replace(/\s*\(\d+\)(\.[a-z0-9]+)$/i, '$1');

      for (const k of Array.from(out)) {
        const noSuffix = removeDupSuffix(k);
        if (noSuffix && noSuffix !== k) out.add(noSuffix);
      }

      return Array.from(out);
    };

    let resolvedKey = loc.key;
    for (const candidate of buildCandidates(loc.key)) {
      try {
        await this.s3Client.send(
          new HeadObjectCommand({ Bucket: loc.bucket, Key: candidate }),
        );
        resolvedKey = candidate;
        break;
      } catch {
        // try next
      }
    }

    const command = new GetObjectCommand({
      Bucket: loc.bucket,
      Key: resolvedKey,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName}"`
        : undefined,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    return { url };
  }

  private resolveContentType(fileName: string, contentType?: string): string {
    const trimmedContentType = contentType?.trim().toLowerCase();
    if (trimmedContentType) {
      if (this.allowedContentTypes.has(trimmedContentType)) {
        return trimmedContentType;
      }

      throw new BadRequestException('Unsupported contentType.');
    }

    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.endsWith('.mp3')) {
      return 'audio/mpeg';
    }
    if (lowerFileName.endsWith('.m4a')) {
      return 'audio/m4a';
    }
    if (lowerFileName.endsWith('.mp4')) {
      return 'audio/mp4';
    }
    if (lowerFileName.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (lowerFileName.endsWith('.png')) {
      return 'image/png';
    }
    if (lowerFileName.endsWith('.jpg') || lowerFileName.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lowerFileName.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lowerFileName.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lowerFileName.endsWith('.txt')) {
      return 'text/plain';
    }
    if (lowerFileName.endsWith('.csv')) {
      return 'text/csv';
    }
    if (lowerFileName.endsWith('.json')) {
      return 'application/json';
    }
    if (lowerFileName.endsWith('.doc')) {
      return 'application/msword';
    }
    if (lowerFileName.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }

    return 'application/octet-stream';
  }
}

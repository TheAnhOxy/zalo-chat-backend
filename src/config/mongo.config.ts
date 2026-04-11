import { MongooseModuleOptions } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

function redactMongoUri(u: string): string {
  return u.replace(/\/\/([^:@]+):([^@]*)@/, '//$1:***@');
}

export const getMongoConfig = (
  configService: ConfigService,
): MongooseModuleOptions => {
  const uri =
    configService.get<string>('MONGODB_URI') ||
    configService.get<string>('DATABASE_URL');

  if (!uri || !uri.startsWith('mongodb')) {
    throw new Error(
      'MONGODB_URI không hợp lệ. Thêm chuỗi kết nối MongoDB Atlas vào file .env (ví dụ: mongodb+srv://...)',
    );
  }

  const autoIndex = configService.get<string>('MONGODB_AUTO_INDEX') !== 'false';

  const isSrv = uri.startsWith('mongodb+srv');
  console.log('[Mongo] MONGODB_URI (đã ẩn mật khẩu):', redactMongoUri(uri));
  console.log('[Mongo] autoIndex =', autoIndex);
  console.log(
    '[Mongo] Loại chuỗi:',
    isSrv
      ? 'mongodb+srv → driver gọi DNS SRV (_mongodb._tcp...)'
      : 'mongodb:// → kết nối thẳng host:port, không SRV',
  );
  if (isSrv) {
    console.log(
      '[Mongo] Nếu gặp querySrv ECONNREFUSED: Atlas → Connect → Drivers → copy chuỗi "standard connection string" (mongodb://...), thay toàn bộ MONGODB_URI trong .env — không cần chỉnh DNS máy.',
    );
  }

  return {
    uri,
    retryWrites: true,
    w: 'majority',
    autoIndex,
  };
};

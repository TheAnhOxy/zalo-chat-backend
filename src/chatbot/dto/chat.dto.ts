import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class ChatHistoryItem {
  @ApiProperty({ enum: ['user', 'model'] })
  @IsString()
  role: 'user' | 'model';

  @ApiProperty()
  @IsString()
  content: string;
}

export class ChatRequestDto {
  @ApiProperty({ description: 'ID của user đang chat với bot' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Tin nhắn của user' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description: 'URL file trên S3 (nếu user gửi file kèm)',
  })
  @IsString()
  @IsOptional()
  fileUrl?: string;

  @ApiPropertyOptional({
    description: 'MIME type của file (image/png, application/pdf...)',
  })
  @IsString()
  @IsOptional()
  fileMimeType?: string;

  @ApiPropertyOptional({
    description:
      'Danh sách file đính kèm (mỗi item gồm url + mimeType). Ưu tiên dùng field này khi gửi nhiều file.',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        mimeType: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['url', 'mimeType'],
    },
  })
  @IsArray()
  @IsOptional()
  files?: { url: string; mimeType: string; name?: string }[];

  @ApiPropertyOptional({
    description:
      'ID cuộc trò chuyện chatbot. Nếu không truyền sẽ tự tạo cuộc trò chuyện mặc định.',
  })
  @IsString()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'Lịch sử chat trước đó',
    type: [ChatHistoryItem],
  })
  @IsArray()
  @IsOptional()
  history?: ChatHistoryItem[];

  @ApiPropertyOptional({
    description:
      'ID cuộc trò chuyện chat thật (nhóm/1-1) cần tóm tắt hoặc hỏi đáp theo nội dung.',
  })
  @IsString()
  @IsOptional()
  targetConversationId?: string;

  @ApiPropertyOptional({
    description:
      'Số tin nhắn gần nhất sẽ đưa vào ngữ cảnh để AI tóm tắt/hỏi đáp. Mặc định 60, tối đa 200.',
  })
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  targetConversationLimit?: number;
}

export class ChatResponseDto {
  @ApiProperty()
  reply: string;

  @ApiProperty({ description: 'Tools đã được gọi trong lượt này' })
  toolsUsed: string[];

  @ApiPropertyOptional({ description: 'conversationId của cuộc chat' })
  conversationId?: string;

  @ApiPropertyOptional({
    description:
      'ID Mongo của tin nhắn user vừa gửi (để client thu hồi ngay lập tức)',
  })
  userMessageId?: string;
}

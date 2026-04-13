import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export function ok<T>(message: string, data: T, statusCode = HttpStatus.OK): {
  statusCode: number;
  body: { success: true; message: string; data: T };
} {
  return {
    statusCode,
    body: {
      success: true,
      message,
      data,
    },
  };
}

export function throwAppError(
  status: HttpStatus,
  code: string,
  message: string,
): never {
  throw new HttpException(
    {
      success: false,
      error: { code, message },
    } satisfies ErrorBody,
    status,
  );
}

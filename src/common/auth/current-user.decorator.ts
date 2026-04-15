import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenUser } from './access-token.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenUser | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenUser }>();
    return req.user;
  },
);

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenUser }>();
    return req.user?.userId;
  },
);

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';

export type AccessTokenUser = {
  userId: string;
  email?: string;
  phone?: string;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenUser }>();
    const auth = req.headers['authorization'];
    const token = this.extractBearerToken(auth);
    if (!token) {
      throw new UnauthorizedException('Missing Authorization bearer token');
    }

    const secret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'dev_access_secret';

    try {
      const payload = jwt.verify(token, secret) as {
        sub?: string;
        email?: string;
        phone?: string;
        type?: string;
      };

      if (!payload?.sub || payload.type !== 'access') {
        throw new UnauthorizedException('Invalid access token');
      }

      req.user = {
        userId: payload.sub,
        email: payload.email,
        phone: payload.phone,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private extractBearerToken(
    header: string | string[] | undefined,
  ): string | null {
    if (!header || typeof header !== 'string') return null;
    const parts = header.split(' ');
    if (parts.length !== 2) return null;
    const [scheme, token] = parts;
    if (scheme.toLowerCase() !== 'bearer') return null;
    return token.trim() || null;
  }
}

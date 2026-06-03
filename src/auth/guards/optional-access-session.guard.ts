import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as jwt from 'jsonwebtoken';
import { Session, SessionDocument } from '../../sessions/schemas/session.schema';

interface AccessJwtPayload {
  sub: string;
  sid?: string;
  type: 'access' | 'refresh' | string;
}

@Injectable()
export class OptionalAccessSessionGuard implements CanActivate {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      path?: string;
    }>();

    const path = req.path || '';
    if (path.startsWith('/auth')) {
      return true;
    }

    const authHeaderRaw = req.headers.authorization;
    const authHeader = Array.isArray(authHeaderRaw)
      ? authHeaderRaw[0]
      : authHeaderRaw;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    const accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'dev_access_secret';

    let payload: AccessJwtPayload;
    try {
      payload = jwt.verify(token, accessSecret) as AccessJwtPayload;
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }

    if (payload.type !== 'access' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (!Types.ObjectId.isValid(payload.sub) || !Types.ObjectId.isValid(payload.sid)) {
      throw new UnauthorizedException('Unauthorized');
    }

    const session = await this.sessionModel
      .findOne({
        _id: new Types.ObjectId(payload.sid),
        userId: new Types.ObjectId(payload.sub),
        isActive: true,
        expiredAt: { $gt: new Date() },
      })
      .lean()
      .exec();

    if (!session) {
      throw new UnauthorizedException('Session has been revoked');
    }

    (req as any).user = {
      userId: payload.sub,
      sessionId: payload.sid,
    };

    return true;
  }
}

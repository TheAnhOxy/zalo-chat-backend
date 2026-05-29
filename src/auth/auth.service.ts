import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Session,
  SessionDevice,
  SessionDocument,
} from '../sessions/schemas/session.schema';
import {
  OtpPurpose,
  OtpSession,
  OtpSessionDocument,
} from './schemas/otp-session.schema';
import {
  LoginChallenge,
  LoginChallengeDocument,
  LoginChallengeStatus,
} from './schemas/login-challenge.schema';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordRequestOtpDto } from './dto/forgot-password-request-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  generateOtpCode,
  generateOtpSessionId,
  isStrongPassword,
  isValidEmail,
  isValidVietnamPhone,
  normalizeEmail,
  normalizePhone,
} from './utils/validators';
import { ok, throwAppError } from './utils/api-response';
import { LoginPhoneRequestOtpDto } from './dto/login-phone-request-otp.dto';
import { LogoutAllDto } from './dto/logout-all.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginChallengeStatusDto } from './dto/login-challenge-status.dto';
import { RealtimeService } from '../realtime/realtime.service';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiredAt: string;
}

interface PendingNewDevicePayload {
  userId: string;
  device: SessionDevice;
  deviceName: string;
  ip: string;
}

interface LoginChallengeTokenPayload {
  challengeId: string;
  action: 'approve' | 'reject';
  type: 'login_challenge';
}

@Injectable()
export class AuthService {
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresDays: number;
  private readonly otpTtlSeconds: number;
  private readonly otpResendSeconds: number;
  private readonly loginChallengeTtlSeconds: number;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(OtpSession.name)
    private readonly otpSessionModel: Model<OtpSessionDocument>,
    @InjectModel(LoginChallenge.name)
    private readonly loginChallengeModel: Model<LoginChallengeDocument>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly realtimeService: RealtimeService,
  ) {
    this.accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m';
    this.refreshExpiresDays = Number(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_DAYS') || '30',
    );
    this.otpTtlSeconds = Number(
      this.configService.get<string>('OTP_EXPIRES_SECONDS') || '120',
    );
    this.otpResendSeconds = Number(
      this.configService.get<string>('OTP_RESEND_SECONDS') || '120',
    );
    this.loginChallengeTtlSeconds = Number(
      this.configService.get<string>('LOGIN_CHALLENGE_EXPIRES_SECONDS') || '600',
    );
  }

  async register(dto: RegisterDto) {
    this.validateRegisterInput(dto);

    const phone = normalizePhone(dto.phone);
    const email = normalizeEmail(dto.email);

    await this.assertUniqueUser(phone, email);

    const otp = generateOtpCode();
    const sessionId = generateOtpSessionId();
    const now = new Date();
    const otpExpiredAt = new Date(now.getTime() + this.otpTtlSeconds * 1000);
    const resendAllowedAt = new Date(
      now.getTime() + this.otpResendSeconds * 1000,
    );

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otpHash = await bcrypt.hash(otp, 10);

    await this.otpSessionModel.create({
      sessionId,
      purpose: OtpPurpose.REGISTER,
      email,
      phone,
      otpHash,
      otpExpiredAt,
      resendAllowedAt,
      payload: {
        fullName: dto.fullName.trim(),
        passwordHash,
      },
    });

    await this.sendOtpEmail(email, otp, OtpPurpose.REGISTER);

    return ok(
      'OTP sent to email',
      {
        sessionId,
        email,
        purpose: OtpPurpose.REGISTER,
        otpExpiredAt: otpExpiredAt.toISOString(),
        resendAfterSeconds: this.otpResendSeconds,
      },
      HttpStatus.CREATED,
    );
  }

  async verifyRegisterOtp(dto: VerifyOtpDto) {
    const otpSession = await this.findOtpSessionOrThrow(dto.sessionId);
    if (otpSession.purpose !== OtpPurpose.REGISTER) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }

    await this.assertOtpIsUsable(otpSession, dto.otp);

    const email = otpSession.email as string;
    const phone = otpSession.phone as string;
    const fullName = String(otpSession.payload.fullName || '').trim();
    const passwordHash = String(otpSession.payload.passwordHash || '');

    await this.assertUniqueUser(phone, email);

    const user = await this.userModel.create({
      fullName,
      phone,
      email,
      password: passwordHash,
      isVerified: true,
      status: {
        isOnline: true,
        lastSeen: new Date(),
      },
    });

    otpSession.usedAt = new Date();
    await otpSession.save();

    const tokens = await this.issueTokensAndSession(user, SessionDevice.WEB, 'Register Device', '0.0.0.0');

    return ok('Register verified', {
      user: this.toAuthUser(user),
      tokens,
    });
  }

  async login(dto: LoginDto, ip: string) {
    const identifier = dto.identifier.trim();
    const query = isValidEmail(identifier)
      ? { email: normalizeEmail(identifier) }
      : { phone: normalizePhone(identifier) };

    const user = await this.userModel.findOne(query).select('+password').exec();

    if (!user) {
      throwAppError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Tai khoan hoac mat khau khong dung',
      );
    }

    const isPassOk = await bcrypt.compare(dto.password, user.password);
    if (!isPassOk) {
      throwAppError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Tai khoan hoac mat khau khong dung',
      );
    }

    if (!user.isVerified) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'ACCOUNT_NOT_VERIFIED',
        'Tai khoan chua xac minh',
      );
    }

    const device = dto.device || SessionDevice.WEB;
    const rawDeviceName = dto.deviceName || 'Unknown Device';
    const fingerprint = this.normalizeFingerprint(dto.deviceFingerprint);
    const deviceName = this.buildDeviceNameWithFingerprint(rawDeviceName, fingerprint);

    const sessions = await this.sessionModel
      .find({ userId: user._id })
      .lean()
      .exec();

    const isTrustedDevice = this.isTrustedDevice(
      sessions,
      fingerprint,
      device,
      rawDeviceName,
    );

    if (sessions.length > 0 && !isTrustedDevice) {
      const now = new Date();
      const challengeId = `LC_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
      const expiresAt = new Date(
        now.getTime() + this.loginChallengeTtlSeconds * 1000,
      );

      await this.loginChallengeModel.create({
        challengeId,
        userId: user._id,
        email: user.email,
        device,
        deviceName,
        ip,
        status: LoginChallengeStatus.PENDING,
        expiresAt,
      });

      await this.sendLoginChallengeEmail({
        challengeId,
        email: user.email,
        device,
        deviceName,
        ip,
      });

      return ok('Need email confirmation for new device login', {
        requiresEmailConfirmation: true,
        challengeId,
        email: user.email,
        challengeExpiredAt: expiresAt.toISOString(),
      });
    }

    user.status = { isOnline: true, lastSeen: new Date() } as User['status'];
    await user.save();

    const tokens = await this.issueTokensAndSession(
      user,
      device,
      deviceName,
      ip,
    );

    return ok('Login success', {
      user: this.toAuthUser(user),
      tokens,
    });
  }

  async requestForgotPasswordOtp(dto: ForgotPasswordRequestOtpDto) {
    const email = normalizeEmail(dto.email);

    if (!isValidEmail(email)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_EMAIL_FORMAT',
        'Email khong dung dinh dang',
      );
    }
    if (!isStrongPassword(dto.newPassword)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
        'Mat khau phai toi thieu 8 ky tu, co chu hoa, chu thuong va so',
      );
    }

    const user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      throwAppError(
        HttpStatus.NOT_FOUND,
        'EMAIL_NOT_FOUND',
        'Email chua duoc dang ky',
      );
    }

    const otp = generateOtpCode();
    const sessionId = generateOtpSessionId();
    const now = new Date();
    const otpExpiredAt = new Date(now.getTime() + this.otpTtlSeconds * 1000);
    const resendAllowedAt = new Date(
      now.getTime() + this.otpResendSeconds * 1000,
    );

    const otpHash = await bcrypt.hash(otp, 10);
    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.otpSessionModel.create({
      sessionId,
      purpose: OtpPurpose.FORGOT_PASSWORD,
      email,
      otpHash,
      otpExpiredAt,
      resendAllowedAt,
      payload: {
        newPasswordHash,
      },
    });

    await this.sendOtpEmail(email, otp, OtpPurpose.FORGOT_PASSWORD);

    return ok('OTP sent for password reset', {
      sessionId,
      email,
      purpose: OtpPurpose.FORGOT_PASSWORD,
      otpExpiredAt: otpExpiredAt.toISOString(),
      resendAfterSeconds: this.otpResendSeconds,
    });
  }

  async verifyForgotPasswordOtp(dto: VerifyOtpDto) {
    const otpSession = await this.findOtpSessionOrThrow(dto.sessionId);
    if (otpSession.purpose !== OtpPurpose.FORGOT_PASSWORD) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }

    await this.assertOtpIsUsable(otpSession, dto.otp);

    const email = otpSession.email as string;
    const newPasswordHash = String(otpSession.payload.newPasswordHash || '');

    const user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      throwAppError(
        HttpStatus.NOT_FOUND,
        'EMAIL_NOT_FOUND',
        'Email chua duoc dang ky',
      );
    }

    user.password = newPasswordHash;
    const updatedAt = new Date();
    await user.save();

    await this.sessionModel.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false } },
    );

    otpSession.usedAt = new Date();
    await otpSession.save();

    return ok('Password reset success', {
      updatedAt: updatedAt.toISOString(),
    });
  }

  async resendOtp(dto: ResendOtpDto) {
    const existing = await this.findOtpSessionOrThrow(dto.sessionId);

    if (existing.usedAt) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_ALREADY_USED',
        'OTP da duoc su dung',
      );
    }

    const now = new Date();
    if (existing.resendAllowedAt > now) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'Chua den thoi gian gui lai OTP',
      );
    }

    const newOtp = generateOtpCode();
    const nextSessionId = generateOtpSessionId();
    const otpHash = await bcrypt.hash(newOtp, 10);
    const otpExpiredAt = new Date(now.getTime() + this.otpTtlSeconds * 1000);
    const resendAllowedAt = new Date(
      now.getTime() + this.otpResendSeconds * 1000,
    );

    await this.otpSessionModel.create({
      sessionId: nextSessionId,
      purpose: existing.purpose,
      email: existing.email,
      phone: existing.phone,
      otpHash,
      otpExpiredAt,
      resendAllowedAt,
      payload: existing.payload,
    });

    existing.usedAt = new Date();
    await existing.save();

    if (existing.email) {
      await this.sendOtpEmail(existing.email, newOtp, existing.purpose);
    }

    return ok('OTP resent', {
      sessionId: nextSessionId,
      email: existing.email,
      phone: existing.phone,
      purpose: existing.purpose,
      otpExpiredAt: otpExpiredAt.toISOString(),
      resendAfterSeconds: this.otpResendSeconds,
    });
  }

  async refreshToken(dto: RefreshTokenDto) {
    const session = await this.sessionModel
      .findOne({
        refreshToken: dto.refreshToken,
        isActive: true,
        expiredAt: { $gt: new Date() },
      })
      .exec();

    if (!session) {
      throwAppError(
        HttpStatus.UNAUTHORIZED,
        'REFRESH_TOKEN_INVALID',
        'Refresh token khong hop le hoac da het han',
      );
    }

    const user = await this.userModel.findById(session.userId).exec();
    if (!user) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    const tokens = this.generateTokenPair(
      user._id.toString(),
      user.email,
      user.phone,
      session._id.toString(),
    );

    session.refreshToken = tokens.refreshToken;
    session.expiredAt = this.getRefreshExpiredAt();
    session.isActive = true;
    await session.save();

    return ok('Token refreshed', tokens);
  }

  async logout(dto: LogoutDto) {
    await this.sessionModel.updateOne(
      { refreshToken: dto.refreshToken, isActive: true },
      { $set: { isActive: false } },
    );

    return ok('Logout success', { loggedOut: true });
  }

  async logoutAllDevices(dto: LogoutAllDto) {
    let userId = dto.userId;

    if (!userId && dto.refreshToken) {
      const session = await this.sessionModel
        .findOne({ refreshToken: dto.refreshToken, isActive: true })
        .exec();
      if (session) {
        userId = session.userId.toString();
      }
    }

    if (!userId) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PAYLOAD',
        'Can truyen userId hoac refreshToken',
      );
    }

    if (!Types.ObjectId.isValid(userId)) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    await this.sessionModel.updateMany(
      { userId: new Types.ObjectId(userId), isActive: true },
      { $set: { isActive: false } },
    );

    try {
      this.realtimeService.emitToRoom(userId, 'force_logout', {
        reason: 'all_devices_logged_out',
      });
    } catch (e) {
      // Ignore emit errors so request still completes
    }

    return ok('Logout all devices success', { userId });
  }

  async listSessions(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    const sessions = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return ok('Sessions fetched', sessions);
  }

  async changePassword(dto: ChangePasswordDto) {
    if (!Types.ObjectId.isValid(dto.userId)) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }
    if (!isStrongPassword(dto.newPassword)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
        'Mat khau phai toi thieu 8 ky tu, co chu hoa, chu thuong va so',
      );
    }

    const user = await this.userModel
      .findById(dto.userId)
      .select('+password')
      .exec();

    if (!user) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    const isOldMatched = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isOldMatched) {
      throwAppError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Tai khoan hoac mat khau khong dung',
      );
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    const updatedAt = new Date();
    await user.save();

    await this.sessionModel.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false } },
    );

    try {
      this.realtimeService.emitToRoom(user._id.toString(), 'force_logout', {
        reason: 'password_changed',
      });
    } catch (e) {
      // Ignore emit errors
    }

    return ok('Change password success', {
      updatedAt: updatedAt.toISOString(),
    });
  }

  async loginPhoneRequestOtp(dto: LoginPhoneRequestOtpDto) {
    const phone = normalizePhone(dto.phone);
    if (!isValidVietnamPhone(phone)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PHONE_FORMAT',
        'So dien thoai khong dung dinh dang',
      );
    }

    const user = await this.userModel.findOne({ phone }).exec();
    if (!user) {
      throwAppError(
        HttpStatus.NOT_FOUND,
        'USER_NOT_FOUND',
        'Khong tim thay tai khoan voi so dien thoai nay',
      );
    }

    const otp = generateOtpCode();
    const sessionId = generateOtpSessionId();
    const now = new Date();
    const otpExpiredAt = new Date(now.getTime() + this.otpTtlSeconds * 1000);
    const resendAllowedAt = new Date(
      now.getTime() + this.otpResendSeconds * 1000,
    );

    await this.otpSessionModel.create({
      sessionId,
      purpose: OtpPurpose.LOGIN_PHONE,
      phone,
      email: user.email,
      otpHash: await bcrypt.hash(otp, 10),
      otpExpiredAt,
      resendAllowedAt,
      payload: {
        userId: user._id.toString(),
      },
    });

    if (user.email) {
      await this.sendOtpEmail(user.email, otp, OtpPurpose.LOGIN_PHONE);
    }

    return ok('OTP sent for phone login', {
      sessionId,
      phone,
      purpose: OtpPurpose.LOGIN_PHONE,
      otpExpiredAt: otpExpiredAt.toISOString(),
      resendAfterSeconds: this.otpResendSeconds,
    });
  }

  async loginPhoneVerifyOtp(dto: VerifyOtpDto, ip: string) {
    const otpSession = await this.findOtpSessionOrThrow(dto.sessionId);
    if (otpSession.purpose !== OtpPurpose.LOGIN_PHONE) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }

    await this.assertOtpIsUsable(otpSession, dto.otp);

    const userId = String(otpSession.payload.userId || '');
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    user.status = { isOnline: true, lastSeen: new Date() } as User['status'];
    await user.save();

    otpSession.usedAt = new Date();
    await otpSession.save();

    const tokens = await this.issueTokensAndSession(
      user,
      SessionDevice.WEB,
      'Phone OTP Login',
      ip,
    );

    return ok('Login success', {
      user: this.toAuthUser(user),
      tokens,
    });
  }

  async approveLoginChallenge(token: string) {
    const payload = this.verifyLoginChallengeToken(token, 'approve');

    const challenge = await this.loginChallengeModel
      .findOne({ challengeId: payload.challengeId })
      .exec();

    if (!challenge || challenge.expiresAt < new Date()) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_INVALID_OR_EXPIRED',
        'Yeu cau xac nhan dang nhap khong hop le hoac da het han',
      );
    }

    if (challenge.status === LoginChallengeStatus.REJECTED) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_REJECTED',
        'Yeu cau dang nhap da bi tu choi',
      );
    }

    if (challenge.status === LoginChallengeStatus.CONSUMED) {
      return ok('Login challenge already completed', {
        challengeId: challenge.challengeId,
        status: challenge.status,
      });
    }

    challenge.status = LoginChallengeStatus.APPROVED;
    challenge.approvedAt = new Date();
    await challenge.save();

    return ok('Da xac nhan dang nhap moi thanh cong', {
      challengeId: challenge.challengeId,
      status: challenge.status,
    });
  }

  async rejectLoginChallenge(token: string) {
    const payload = this.verifyLoginChallengeToken(token, 'reject');

    const challenge = await this.loginChallengeModel
      .findOne({ challengeId: payload.challengeId })
      .exec();

    if (!challenge || challenge.expiresAt < new Date()) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_INVALID_OR_EXPIRED',
        'Yeu cau xac nhan dang nhap khong hop le hoac da het han',
      );
    }

    if (challenge.status === LoginChallengeStatus.CONSUMED) {
      return ok('Login challenge already completed', {
        challengeId: challenge.challengeId,
        status: challenge.status,
      });
    }

    challenge.status = LoginChallengeStatus.REJECTED;
    challenge.rejectedAt = new Date();
    await challenge.save();

    return ok('Da tu choi dang nhap moi', {
      challengeId: challenge.challengeId,
      status: challenge.status,
    });
  }

  async loginChallengeStatus(dto: LoginChallengeStatusDto) {
    const challenge = await this.loginChallengeModel
      .findOne({ challengeId: dto.challengeId })
      .exec();

    if (!challenge || challenge.expiresAt < new Date()) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_INVALID_OR_EXPIRED',
        'Yeu cau xac nhan dang nhap khong hop le hoac da het han',
      );
    }

    if (challenge.status === LoginChallengeStatus.PENDING) {
      return ok('Challenge is still pending', {
        challengeId: challenge.challengeId,
        status: challenge.status,
      });
    }

    if (challenge.status === LoginChallengeStatus.REJECTED) {
      throwAppError(
        HttpStatus.UNAUTHORIZED,
        'LOGIN_CHALLENGE_REJECTED',
        'Dang nhap moi da bi tu choi',
      );
    }

    if (challenge.status === LoginChallengeStatus.CONSUMED) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_ALREADY_COMPLETED',
        'Yeu cau dang nhap da hoan tat',
      );
    }

    const user = await this.userModel.findById(challenge.userId).exec();
    if (!user) {
      throwAppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Khong tim thay user');
    }

    user.status = { isOnline: true, lastSeen: new Date() } as User['status'];
    await user.save();

    const tokens = await this.issueTokensAndSession(
      user,
      this.parseSessionDevice(challenge.device),
      challenge.deviceName,
      challenge.ip,
    );

    challenge.status = LoginChallengeStatus.CONSUMED;
    challenge.consumedAt = new Date();
    await challenge.save();

    return ok('Login confirmed. Session created', {
      challengeId: challenge.challengeId,
      status: challenge.status,
      user: this.toAuthUser(user),
      tokens,
    });
  }

  async googleLogin(dto: GoogleLoginDto, ip: string) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PAYLOAD',
        'GOOGLE_CLIENT_ID chua duoc cau hinh',
      );
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: dto.idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();

    if (!payload?.email) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PAYLOAD',
        'Khong lay duoc email tu Google',
      );
    }

    const email = normalizeEmail(payload.email);
    let user = await this.userModel.findOne({ email }).exec();

    if (!user) {
      const fakePhone = await this.generateUniqueGooglePhone();
      user = await this.userModel.create({
        fullName: payload.name || 'Google User',
        email,
        phone: fakePhone,
        password: await bcrypt.hash(`${Date.now()}_GOOGLE`, 10),
        avatar: payload.picture || '',
        isVerified: true,
        status: { isOnline: true, lastSeen: new Date() },
      });
    }

    const tokens = await this.issueTokensAndSession(
      user,
      dto.device || SessionDevice.WEB,
      dto.deviceName || 'Google Login',
      ip,
    );

    return ok('Login success', {
      user: this.toAuthUser(user),
      tokens,
    });
  }

  private validateRegisterInput(dto: RegisterDto): void {
    if (!dto.fullName || dto.fullName.trim().length < 2) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PAYLOAD',
        'Ho ten phai toi thieu 2 ky tu',
      );
    }

    const phone = normalizePhone(dto.phone);
    if (!isValidVietnamPhone(phone)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PHONE_FORMAT',
        'So dien thoai khong dung dinh dang',
      );
    }

    const email = normalizeEmail(dto.email);
    if (!isValidEmail(email)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_EMAIL_FORMAT',
        'Email khong dung dinh dang',
      );
    }

    if (!isStrongPassword(dto.password)) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
        'Mat khau phai toi thieu 8 ky tu, co chu hoa, chu thuong va so',
      );
    }
  }

  private async assertUniqueUser(phone: string, email: string): Promise<void> {
    const [phoneExists, emailExists] = await Promise.all([
      this.userModel.exists({ phone }),
      this.userModel.exists({ email }),
    ]);

    if (phoneExists) {
      throwAppError(
        HttpStatus.CONFLICT,
        'PHONE_ALREADY_EXISTS',
        'So dien thoai da duoc dang ky',
      );
    }

    if (emailExists) {
      throwAppError(
        HttpStatus.CONFLICT,
        'EMAIL_ALREADY_EXISTS',
        'Email da duoc dang ky',
      );
    }
  }

  private async findOtpSessionOrThrow(sessionId: string): Promise<OtpSessionDocument> {
    const doc = await this.otpSessionModel
      .findOne({ sessionId })
      .select('+otpHash')
      .exec();

    if (!doc) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }

    return doc;
  }

  private async assertOtpIsUsable(
    otpSession: OtpSessionDocument,
    otp: string,
  ): Promise<void> {
    if (otpSession.usedAt) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_ALREADY_USED',
        'OTP da duoc su dung',
      );
    }

    if (otpSession.otpExpiredAt < new Date()) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }

    const matched = await bcrypt.compare(otp, otpSession.otpHash);
    if (!matched) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID_OR_EXPIRED',
        'OTP khong hop le hoac da het han',
      );
    }
  }

  private generateTokenPair(
    userId: string,
    email: string,
    phone: string,
    sessionId: string,
  ): TokenPair {
    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId, email, phone, type: 'access' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'dev_access_secret',
        expiresIn: this.parseSeconds(this.accessExpiresIn),
      },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, sid: sessionId, email, phone, type: 'refresh' },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'dev_refresh_secret',
        expiresIn: this.refreshExpiresDays * 24 * 60 * 60,
      },
    );

    const accessExpiredAt = new Date(Date.now() + this.parseMs(this.accessExpiresIn));

    return {
      accessToken,
      refreshToken,
      accessExpiredAt: accessExpiredAt.toISOString(),
    };
  }

  private async issueTokensAndSession(
    user: UserDocument,
    device: SessionDevice,
    deviceName: string,
    ip: string,
  ): Promise<TokenPair> {
    const session = await this.sessionModel.create({
      userId: user._id,
      device,
      deviceName,
      ip,
      refreshToken: `TEMP_${new Types.ObjectId().toString()}_${Date.now()}`,
      expiredAt: this.getRefreshExpiredAt(),
      isActive: true,
    });

    const tokens = this.generateTokenPair(
      user._id.toString(),
      user.email,
      user.phone,
      session._id.toString(),
    );

    session.refreshToken = tokens.refreshToken;
    await session.save();

    return tokens;
  }

  private toAuthUser(user: UserDocument): Record<string, unknown> {
    return {
      id: user._id.toString(),
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar || '',
      isVerified: user.isVerified,
      status: {
        isOnline: user.status?.isOnline ?? false,
        lastSeen: user.status?.lastSeen
          ? new Date(user.status.lastSeen).toISOString()
          : null,
      },
    };
  }

  private parseSeconds(input: string): number {
    if (input.endsWith('m')) return Number(input.slice(0, -1)) * 60;
    if (input.endsWith('h')) return Number(input.slice(0, -1)) * 60 * 60;
    if (input.endsWith('d')) return Number(input.slice(0, -1)) * 24 * 60 * 60;
    const n = Number(input);
    return Number.isFinite(n) && n > 0 ? n : 15 * 60;
  }

  private parseMs(input: string): number {
    if (input.endsWith('m')) return Number(input.slice(0, -1)) * 60 * 1000;
    if (input.endsWith('h')) return Number(input.slice(0, -1)) * 60 * 60 * 1000;
    if (input.endsWith('d')) return Number(input.slice(0, -1)) * 24 * 60 * 60 * 1000;
    const n = Number(input);
    return Number.isFinite(n) && n > 0 ? n * 1000 : 15 * 60 * 1000;
  }

  private parseSessionDevice(value: unknown): SessionDevice {
    if (value === SessionDevice.ANDROID) return SessionDevice.ANDROID;
    if (value === SessionDevice.IOS) return SessionDevice.IOS;
    return SessionDevice.WEB;
  }

  private normalizeFingerprint(value?: string): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private buildDeviceNameWithFingerprint(
    deviceName: string,
    fingerprint: string | null,
  ): string {
    if (!fingerprint) return deviceName;
    if (deviceName.includes('fp=')) return deviceName;
    return `${deviceName} | fp=${fingerprint}`;
  }

  private extractFingerprintFromDeviceName(deviceName: string): string | null {
    const match = deviceName.match(/\bfp=([a-zA-Z0-9_-]+)\b/);
    return match ? match[1] : null;
  }

  private stripFingerprintFromDeviceName(deviceName: string): string {
    return deviceName.replace(/\s*\|\s*fp=[a-zA-Z0-9_-]+\s*$/g, '').trim();
  }

  private isTrustedDevice(
    sessions: Array<{ device?: SessionDevice; deviceName?: string }>,
    fingerprint: string | null,
    device: SessionDevice,
    rawDeviceName: string,
  ): boolean {
    if (sessions.length === 0) return false;

    if (fingerprint) {
      return sessions.some((s) => {
        const name = s.deviceName || '';
        return this.extractFingerprintFromDeviceName(name) === fingerprint;
      });
    }

    return sessions.some((s) => {
      const name = this.stripFingerprintFromDeviceName(s.deviceName || '');
      return s.device === device && name === rawDeviceName;
    });
  }

  private signLoginChallengeToken(
    challengeId: string,
    action: 'approve' | 'reject',
  ): string {
    return this.jwtService.sign(
      {
        challengeId,
        action,
        type: 'login_challenge',
      } satisfies LoginChallengeTokenPayload,
      {
        secret:
          this.configService.get<string>('LOGIN_CHALLENGE_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'dev_login_challenge_secret',
        expiresIn: this.loginChallengeTtlSeconds,
      },
    );
  }

  private verifyLoginChallengeToken(
    token: string,
    expectedAction: 'approve' | 'reject',
  ): LoginChallengeTokenPayload {
    let payload: LoginChallengeTokenPayload;

    try {
      payload = this.jwtService.verify<LoginChallengeTokenPayload>(token, {
        secret:
          this.configService.get<string>('LOGIN_CHALLENGE_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'dev_login_challenge_secret',
      });
    } catch {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_INVALID_OR_EXPIRED',
        'Yeu cau xac nhan dang nhap khong hop le hoac da het han',
      );
    }

    if (
      payload.type !== 'login_challenge' ||
      payload.action !== expectedAction ||
      !payload.challengeId
    ) {
      throwAppError(
        HttpStatus.BAD_REQUEST,
        'LOGIN_CHALLENGE_INVALID_OR_EXPIRED',
        'Yeu cau xac nhan dang nhap khong hop le hoac da het han',
      );
    }

    return payload;
  }

  private async sendLoginChallengeEmail(params: {
    challengeId: string;
    email: string;
    device: SessionDevice;
    deviceName: string;
    ip: string;
  }): Promise<void> {
    const { challengeId, email, device, deviceName, ip } = params;
    const serverBaseUrl =
      this.configService.get<string>('SERVER_PUBLIC_URL') ||
      `http://localhost:${this.configService.get<string>('PORT') || '8081'}`;

    const approveToken = this.signLoginChallengeToken(challengeId, 'approve');
    const rejectToken = this.signLoginChallengeToken(challengeId, 'reject');

    const approveUrl = `${serverBaseUrl}/auth/login/challenge/approve?token=${encodeURIComponent(approveToken)}`;
    const rejectUrl = `${serverBaseUrl}/auth/login/challenge/reject?token=${encodeURIComponent(rejectToken)}`;

    const host = this.configService.get<string>('SMTP_HOST');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM') || user;

    if (!host || !user || !pass) {
      throwAppError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'SMTP chua duoc cau hinh day du, khong the gui email xac nhan dang nhap',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get<string>('SMTP_PORT') || '587'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: { user, pass },
    });

    const text = [
      'He thong phat hien yeu cau dang nhap moi.',
      `Thiet bi: ${deviceName} (${device})`,
      `IP: ${ip}`,
      '',
      'Neu day la ban, bam link xac nhan:',
      approveUrl,
      '',
      'Neu khong phai ban, bam link tu choi:',
      rejectUrl,
    ].join('\n');

    const safeDeviceName = this.escapeHtml(this.stripFingerprintFromDeviceName(deviceName));
    const safeIp = this.escapeHtml(ip);
    const safeChallengeId = this.escapeHtml(challengeId);

    const html = `
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Xac nhan dang nhap moi</title>
  </head>
  <body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,.08);">
            <tr><td style="font-size:12px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:.08em;">Zalo Chat Security</td></tr>
            <tr><td style="padding-top:8px;font-size:24px;font-weight:700;color:#111827;">Phat hien dang nhap moi</td></tr>
            <tr><td style="padding-top:10px;font-size:15px;line-height:1.65;color:#374151;">He thong ghi nhan mot yeu cau dang nhap moi vao tai khoan cua ban.</td></tr>
            <tr>
              <td style="padding-top:16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px;">
                  <tr><td style="font-size:14px;color:#374151;"><strong>Thiet bi:</strong> ${safeDeviceName} (${device})</td></tr>
                  <tr><td style="font-size:14px;color:#374151;padding-top:8px;"><strong>IP:</strong> ${safeIp}</td></tr>
                  <tr><td style="font-size:12px;color:#6b7280;padding-top:8px;">Challenge ID: ${safeChallengeId}</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:22px;">
                <a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Dong y</a>
                <a href="${rejectUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;margin-left:10px;">Tu choi</a>
              </td>
            </tr>
            <tr><td style="padding-top:18px;font-size:13px;line-height:1.6;color:#6b7280;">Neu khong phai ban, hay bam <strong>Tu choi</strong> va doi mat khau ngay de bao ve tai khoan.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    await transporter.sendMail({
      from,
      to: email,
      subject: 'Zalo Chat - Xac nhan dang nhap moi',
      text,
      html,
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getRefreshExpiredAt(): Date {
    return new Date(Date.now() + this.refreshExpiresDays * 24 * 60 * 60 * 1000);
  }

  private async sendOtpEmail(
    email: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const host = this.configService.get<string>('SMTP_HOST');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM') || user;

    if (!host || !user || !pass) {
      throwAppError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'SMTP chua duoc cau hinh day du, khong the gui OTP',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get<string>('SMTP_PORT') || '587'),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: { user, pass },
    });

    try {
      await transporter.sendMail({
        from,
        to: email,
        subject:
          purpose === OtpPurpose.LOGIN_NEW_DEVICE
            ? 'Zalo Chat - Xac nhan dang nhap thiet bi moi'
            : 'Zalo Chat OTP',
        text:
          purpose === OtpPurpose.LOGIN_NEW_DEVICE
            ? `He thong phat hien mot dang nhap moi. Ma xac nhan cua ban la: ${otp}. OTP co hieu luc trong ${this.otpTtlSeconds} giay. Neu khong phai ban, hay doi mat khau ngay.`
            : `Ma OTP cua ban la: ${otp}. OTP co hieu luc trong ${this.otpTtlSeconds} giay.`,
      });
      console.log(`[Email Sent] OTP sent to ${email} for ${purpose}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown SMTP error';
      console.error(`[Email Error] ${message}`);
      throwAppError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Gui OTP that bai, vui long kiem tra cau hinh SMTP va thu lai',
      );
    }
  }

  private async generateUniqueGooglePhone(): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const candidate = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
      const exists = await this.userModel.exists({ phone: candidate });
      if (!exists) {
        return candidate;
      }
    }

    throwAppError(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_SERVER_ERROR',
      'Khong the tao so dien thoai tam cho tai khoan Google',
    );
  }

  /**
   * DEV ONLY: Get OTP from session
   * This is for testing purposes - remove in production!
   */
  async getOtpForDev(sessionId: string): Promise<Record<string, unknown>> {
    const otpSession = await this.otpSessionModel
      .findOne({ sessionId })
      .select('+otpHash')
      .exec();

    if (!otpSession) {
      throwAppError(
        HttpStatus.NOT_FOUND,
        'OTP_INVALID_OR_EXPIRED',
        'Khong tim thay OTP session',
      );
    }

    // This is dev only - normally you wouldn't return OTP
    // In production, remove this endpoint
    return ok('OTP fetched for dev', {
      sessionId,
      message: 'OTP already sent to email. Check server console or email client. This endpoint is DEV ONLY!',
      email: otpSession.email,
      phone: otpSession.phone,
      purpose: otpSession.purpose,
      expiresAt: otpSession.otpExpiredAt.toISOString(),
      note: 'OTP was logged to server console during creation. Check there or your email inbox (Ethereal).',
    });
  }
}

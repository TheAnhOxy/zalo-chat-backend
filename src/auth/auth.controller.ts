import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordRequestOtpDto } from './dto/forgot-password-request-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { LogoutAllDto } from './dto/logout-all.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginPhoneRequestOtpDto } from './dto/login-phone-request-otp.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register account, send OTP to email' })
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    const result = await this.authService.register(dto);
    return res.status(result.statusCode).json(result.body);
  }

  @Post('verify-register-otp')
  @ApiOperation({ summary: 'Verify OTP register and create account' })
  verifyRegisterOtp(
    @Body() dto: VerifyOtpDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.verifyRegisterOtp(dto).then((x) => x.body);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with phone/email + password' })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.authService.login(dto, this.extractIp(req)).then((x) => x.body);
  }

  @Post('forgot-password/request-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request OTP to reset password' })
  forgotPasswordRequestOtp(
    @Body() dto: ForgotPasswordRequestOtpDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.requestForgotPasswordOtp(dto).then((x) => x.body);
  }

  @Post('forgot-password/verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify OTP and reset password' })
  forgotPasswordVerifyOtp(
    @Body() dto: VerifyOtpDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.verifyForgotPasswordOtp(dto).then((x) => x.body);
  }

  @Post('otp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend OTP' })
  resendOtp(@Body() dto: ResendOtpDto): Promise<Record<string, unknown>> {
    return this.authService.resendOtp(dto).then((x) => x.body);
  }

  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token with refresh token' })
  refreshToken(@Body() dto: RefreshTokenDto): Promise<Record<string, unknown>> {
    return this.authService.refreshToken(dto).then((x) => x.body);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout current device by refresh token' })
  logout(@Body() dto: LogoutDto): Promise<Record<string, unknown>> {
    return this.authService.logout(dto).then((x) => x.body);
  }

  @Post('logout-all-devices')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout all devices by userId or refreshToken' })
  logoutAll(@Body() dto: LogoutAllDto): Promise<Record<string, unknown>> {
    return this.authService.logoutAllDevices(dto).then((x) => x.body);
  }

  @Get('sessions/:userId')
  @ApiOperation({ summary: 'List sessions of a user' })
  listSessions(
    @Param('userId') userId: string,
  ): Promise<Record<string, unknown>> {
    return this.authService.listSessions(userId).then((x) => x.body);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change password and revoke all sessions' })
  changePassword(
    @Body() dto: ChangePasswordDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.changePassword(dto).then((x) => x.body);
  }

  @Post('phone-login/request-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request OTP for login by phone' })
  phoneLoginRequestOtp(
    @Body() dto: LoginPhoneRequestOtpDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.loginPhoneRequestOtp(dto).then((x) => x.body);
  }

  @Post('phone-login/verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify OTP and login by phone' })
  phoneLoginVerifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.authService
      .loginPhoneVerifyOtp(dto, this.extractIp(req))
      .then((x) => x.body);
  }

  @Post('google-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login/Register with Google ID token' })
  googleLogin(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.authService
      .googleLogin(dto, this.extractIp(req))
      .then((x) => x.body);
  }

  /**
   * DEV ONLY: Get OTP for testing
   * Call this to retrieve OTP for a sessionId without needing email
   */
  @Get('dev/otp/:sessionId')
  @ApiOperation({
    summary: '[DEV] Get OTP from session - remove in production!',
  })
  async getOtpForDev(
    @Param('sessionId') sessionId: string,
  ): Promise<Record<string, unknown>> {
    return this.authService
      .getOtpForDev(sessionId)
      .then((x) => x.body as Record<string, unknown>);
  }

  private extractIp(req: Request): string {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
      return xForwardedFor.split(',')[0].trim();
    }
    return req.ip || '0.0.0.0';
  }
}

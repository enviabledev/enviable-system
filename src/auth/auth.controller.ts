import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  Audit,
  CurrentUser,
  PasswordResetExempt,
  Public,
} from '../common/decorators';
import { AuthService, Principal } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

export const SESSION_COOKIE_NAME = 'enviable.sid';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Session-fixation defence: regenerate the session id BEFORE storing the
    // principal, so the post-login id cannot match any pre-login (potentially
    // attacker-planted) id. This folds in the M5 hardening item early. Only the
    // userId is stored; the full principal is resolved per request so that
    // permission changes take effect without re-login.
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    return this.auth.getPrincipal(user.id);
  }

  // Exempt from the reset gate so a must-reset user can still resolve their
  // session (and read the mustResetPassword flag the frontend redirects on).
  @PasswordResetExempt()
  @Get('me')
  async me(@Req() req: Request) {
    const userId = req.session.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }
    const principal = await this.auth.getPrincipal(userId);
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  }

  // Self-service password reset and the endpoint the forced-reset flow uses.
  // Authenticated (not @Public): the session proves identity, the body proves
  // knowledge of the current password. Marked exempt so a must-reset user can
  // reach it. @Audit records the event; no password value ever enters the audit
  // row (afterState is the refreshed principal, which carries no hash).
  @PasswordResetExempt()
  @Post('reset-password')
  @HttpCode(200)
  @Audit('user.password_reset', 'User')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: Principal,
  ) {
    return this.auth.resetPassword(
      actor.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    res.clearCookie(SESSION_COOKIE_NAME);
    return { ok: true };
  }
}

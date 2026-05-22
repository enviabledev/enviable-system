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
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

export const SESSION_COOKIE_NAME = 'enviable.sid';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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

import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { AccountLifecycleService } from "./account-lifecycle.service.js";
import { EmailActionRequestDto } from "./dto/email-action-request.dto.js";
import { EmailVerificationDto } from "./dto/email-verification.dto.js";
import { PasswordResetDto } from "./dto/password-reset.dto.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshDto } from "./dto/refresh.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import type { AuthenticatedUser } from "./interfaces/authenticated-user.interface.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountLifecycle: AccountLifecycleService,
  ) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("email/verification/request")
  requestEmailVerification(@Body() dto: EmailActionRequestDto) {
    return this.accountLifecycle.requestEmailVerification(dto.email);
  }

  @Post("email/verification/confirm")
  confirmEmailVerification(@Body() dto: EmailVerificationDto) {
    return this.accountLifecycle.confirmEmailVerification(dto.token);
  }

  @Post("password/forgot")
  requestPasswordReset(@Body() dto: EmailActionRequestDto) {
    return this.accountLifecycle.requestPasswordReset(dto.email);
  }

  @Post("password/reset")
  resetPassword(@Body() dto: PasswordResetDto) {
    return this.accountLifecycle.resetPassword(dto.token, dto.password);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post("logout")
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete("sessions/:familyId")
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("familyId") familyId: string,
  ) {
    return this.authService.revokeSession(user, familyId);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user);
  }
}

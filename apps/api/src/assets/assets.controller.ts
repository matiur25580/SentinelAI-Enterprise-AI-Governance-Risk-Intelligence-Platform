import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { MembershipRole } from "../generated/prisma/client.js";
import { AssetsService } from "./assets.service.js";
import { CreateAssetDto } from "./dto/create-asset.dto.js";
import { UpdateAssetDto } from "./dto/update-asset.dto.js";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.AI_ENGINEER)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAssetDto) {
    return this.assetsService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.assetsService.list(user);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.assetsService.get(user, id);
  }

  @Patch(":id")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.AI_ENGINEER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(user, id, dto);
  }

  @Delete(":id")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.assetsService.remove(user, id);
  }
}

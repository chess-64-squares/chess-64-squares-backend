import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { IsISO31661Alpha2, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import type { PublicUser, UserProfile } from 'chess-64-squares-shared';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { NoGuests } from '../common/auth/jwt-auth.guard';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { UsersService } from './users.service';

class UpdateMeDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsISO31661Alpha2()
  country?: string;
}

class SearchQueryDto {
  @IsString()
  @MaxLength(32)
  q!: string;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search')
  search(@Query() query: SearchQueryDto): Promise<PublicUser[]> {
    return this.usersService.search(query.q);
  }

  @Get(':id/profile')
  profile(@Param('id', ParseUUIDPipe) id: string): Promise<UserProfile> {
    return this.usersService.profile(id);
  }

  @Patch('me')
  @NoGuests()
  updateMe(@CurrentUser() user: AuthedUser, @Body() dto: UpdateMeDto): Promise<PublicUser> {
    return this.usersService.updateMe(user.id, {
      avatarUrl: dto.avatarUrl,
      country: dto.country,
    });
  }
}

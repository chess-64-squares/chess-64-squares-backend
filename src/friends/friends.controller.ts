import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { FriendEntry, FriendRequestEntry } from 'chess-64-squares-shared';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { NoGuests } from '../common/auth/jwt-auth.guard';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { FriendsService } from './friends.service';

class SendRequestDto {
  @IsUUID()
  toUserId!: string;
}

@Controller('friends')
@NoGuests()
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser): Promise<FriendEntry[]> {
    return this.friends.listFriends(user.id);
  }

  @Get('requests')
  requests(@CurrentUser() user: AuthedUser): Promise<{
    incoming: FriendRequestEntry[];
    outgoing: FriendRequestEntry[];
  }> {
    return this.friends.listRequests(user.id);
  }

  @Post('requests')
  send(
    @CurrentUser() user: AuthedUser,
    @Body() dto: SendRequestDto,
  ): Promise<FriendRequestEntry> {
    return this.friends.sendRequest(user.id, dto.toUserId);
  }

  @Post('requests/:id/accept')
  accept(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FriendRequestEntry> {
    return this.friends.respond(id, user.id, true);
  }

  @Post('requests/:id/decline')
  decline(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FriendRequestEntry> {
    return this.friends.respond(id, user.id, false);
  }

  @Delete(':userId')
  async remove(
    @CurrentUser() user: AuthedUser,
    @Param('userId', ParseUUIDPipe) otherUserId: string,
  ): Promise<{ ok: true }> {
    await this.friends.removeFriend(user.id, otherUserId);
    return { ok: true };
  }
}

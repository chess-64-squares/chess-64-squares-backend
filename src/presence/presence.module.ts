import { Module, forwardRef } from '@nestjs/common';
import { FriendsModule } from '../friends/friends.module';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [forwardRef(() => FriendsModule)],
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService],
})
export class PresenceModule {}

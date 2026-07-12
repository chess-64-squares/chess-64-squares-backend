import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import type { FriendEntry, FriendRequestEntry, PublicUser } from 'chess-64-squares-shared';
import { toPublicUser } from '../auth/auth.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { FriendRequestEntity, UserEntity } from '../database/entities';
import { PresenceService } from '../presence/presence.service';

const friendsCacheKey = (userId: string): string => `c64:friends:${userId}`;
const FRIENDS_CACHE_TTL_SEC = 300;

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(FriendRequestEntity)
    private readonly requests: Repository<FriendRequestEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly presence: PresenceService,
  ) {}

  async sendRequest(fromUserId: string, toUserId: string): Promise<FriendRequestEntry> {
    if (fromUserId === toUserId) throw new BadRequestException('You cannot befriend yourself');
    const target = await this.users.findOneBy({ id: toUserId });
    if (!target) throw new NotFoundException('User not found');
    if (target.isGuest) throw new BadRequestException('Guests cannot receive friend requests');

    const existing = await this.requests.findOne({
      where: [
        { fromUserId, toUserId },
        { fromUserId: toUserId, toUserId: fromUserId },
      ],
    });
    if (existing) {
      if (existing.status === 'accepted') throw new ConflictException('Already friends');
      if (existing.status === 'pending') {
        // they already asked us → accept instead of duplicating
        if (existing.fromUserId === toUserId) return this.respond(existing.id, fromUserId, true);
        throw new ConflictException('Request already pending');
      }
      // declined earlier — allow retrying by refreshing the row
      existing.fromUserId = fromUserId;
      existing.toUserId = toUserId;
      existing.status = 'pending';
      existing.respondedAt = null;
      const saved = await this.requests.save(existing);
      return this.toEntry(saved);
    }

    const saved = await this.requests.save(
      this.requests.create({ fromUserId, toUserId, status: 'pending' }),
    );
    return this.toEntry(saved);
  }

  async respond(requestId: string, userId: string, accept: boolean): Promise<FriendRequestEntry> {
    const request = await this.requests.findOneBy({ id: requestId });
    if (!request) throw new NotFoundException('Request not found');
    if (request.toUserId !== userId) {
      throw new BadRequestException('Only the recipient can respond');
    }
    if (request.status !== 'pending') throw new ConflictException('Request already handled');
    request.status = accept ? 'accepted' : 'declined';
    request.respondedAt = new Date();
    const saved = await this.requests.save(request);
    await this.invalidateFriendsCache(request.fromUserId, request.toUserId);
    return this.toEntry(saved);
  }

  async removeFriend(userId: string, otherUserId: string): Promise<void> {
    await this.requests.delete([
      { fromUserId: userId, toUserId: otherUserId, status: 'accepted' },
      { fromUserId: otherUserId, toUserId: userId, status: 'accepted' },
    ] as never);
    await this.invalidateFriendsCache(userId, otherUserId);
  }

  async listFriends(userId: string): Promise<FriendEntry[]> {
    const rows = await this.requests.find({
      where: [
        { fromUserId: userId, status: 'accepted' },
        { toUserId: userId, status: 'accepted' },
      ],
    });
    if (rows.length === 0) return [];
    const friendIds = rows.map((r) => (r.fromUserId === userId ? r.toUserId : r.fromUserId));
    const [friendUsers, onlineSet] = await Promise.all([
      this.users.findBy({ id: In(friendIds) }),
      this.presence.onlineAmong(friendIds),
    ]);
    const sinceById = new Map(
      rows.map((r) => [
        r.fromUserId === userId ? r.toUserId : r.fromUserId,
        (r.respondedAt ?? r.createdAt).toISOString(),
      ]),
    );
    return friendUsers.map((u) => ({
      user: toPublicUser(u),
      online: onlineSet.has(u.id),
      since: sinceById.get(u.id) ?? new Date(0).toISOString(),
    }));
  }

  async listRequests(userId: string): Promise<{
    incoming: FriendRequestEntry[];
    outgoing: FriendRequestEntry[];
  }> {
    const [incoming, outgoing] = await Promise.all([
      this.requests.find({ where: { toUserId: userId, status: 'pending' } }),
      this.requests.find({ where: { fromUserId: userId, status: 'pending' } }),
    ]);
    return {
      incoming: await Promise.all(incoming.map((r) => this.toEntry(r))),
      outgoing: await Promise.all(outgoing.map((r) => this.toEntry(r))),
    };
  }

  /** friend ids, cached — presence broadcasts hit this on every connect/disconnect */
  async friendIds(userId: string): Promise<string[]> {
    const cached = await this.redis.smembers(friendsCacheKey(userId)).catch(() => []);
    if (cached.length > 0) return cached.filter((id) => id !== '__empty__');

    const rows = await this.requests.find({
      where: [
        { fromUserId: userId, status: 'accepted' },
        { toUserId: userId, status: 'accepted' },
      ],
    });
    const ids = rows.map((r) => (r.fromUserId === userId ? r.toUserId : r.fromUserId));
    const key = friendsCacheKey(userId);
    await this.redis
      .multi()
      .del(key)
      .sadd(key, ids.length > 0 ? ids : ['__empty__'])
      .expire(key, FRIENDS_CACHE_TTL_SEC)
      .exec()
      .catch(() => undefined);
    return ids;
  }

  private async invalidateFriendsCache(...userIds: string[]): Promise<void> {
    await this.redis.del(...userIds.map(friendsCacheKey)).catch(() => undefined);
  }

  private async toEntry(row: FriendRequestEntity): Promise<FriendRequestEntry> {
    const [from, to] = await Promise.all([
      this.users.findOneBy({ id: row.fromUserId }),
      this.users.findOneBy({ id: row.toUserId }),
    ]);
    const fallback: PublicUser = {
      id: 'deleted',
      username: 'Deleted user',
      avatarUrl: null,
      country: null,
      isGuest: false,
      isEmailVerified: false,
      createdAt: new Date(0).toISOString(),
    };
    return {
      id: row.id,
      from: from ? toPublicUser(from) : fallback,
      to: to ? toPublicUser(to) : fallback,
      status: row.status as FriendRequestEntry['status'],
      createdAt: row.createdAt.toISOString(),
    };
  }
}

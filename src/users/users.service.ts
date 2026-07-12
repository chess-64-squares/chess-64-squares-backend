import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import type {
  PublicUser,
  RatingSnapshot,
  TimeControlCategory,
  UserProfile,
} from 'chess-64-squares-shared';
import { toPublicUser } from '../auth/auth.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { GameEntity, RatingEntity, UserEntity } from '../database/entities';

const PROFILE_TTL_SEC = 60;

const profileKey = (userId: string): string => `c64:profile:${userId}`;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(RatingEntity) private readonly ratings: Repository<RatingEntity>,
    @InjectRepository(GameEntity) private readonly games: Repository<GameEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findById(id: string): Promise<UserEntity | null> {
    return this.users.findOneBy({ id });
  }

  async publicUser(id: string): Promise<PublicUser> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  /**
   * Public profile — served from the Redis cache while warm so profile views
   * never hit Postgres (ARCHITECTURE.md §2.7). Invalidated on writes.
   */
  async profile(userId: string): Promise<UserProfile> {
    const cached = await this.redis.get(profileKey(userId)).catch(() => null);
    if (cached) return JSON.parse(cached) as UserProfile;

    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const [ratingRows, totalGames] = await Promise.all([
      this.ratings.findBy({ userId }),
      this.games
        .createQueryBuilder('g')
        .where('(g.white_user_id = :id OR g.black_user_id = :id)', { id: userId })
        .andWhere('g.ended_at IS NOT NULL')
        .getCount(),
    ]);

    const profile: UserProfile = {
      ...toPublicUser(user),
      ratings: ratingRows.map(
        (r): RatingSnapshot => ({
          category: r.category as TimeControlCategory,
          rating: r.rating,
          gamesPlayed: r.gamesPlayed,
        }),
      ),
      totalGames,
      botStreak: user.botStreak,
    };

    await this.redis
      .set(profileKey(userId), JSON.stringify(profile), 'EX', PROFILE_TTL_SEC)
      .catch(() => undefined);
    return profile;
  }

  async invalidateProfile(userId: string): Promise<void> {
    await this.redis.del(profileKey(userId)).catch(() => undefined);
  }

  async search(query: string, limit = 20): Promise<PublicUser[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const rows = await this.users
      .createQueryBuilder('u')
      .where('lower(u.username) LIKE lower(:q)', { q: `${q}%` })
      .andWhere('u.is_guest = false')
      .orderBy('u.username', 'ASC')
      .take(Math.min(limit, 50))
      .getMany();
    return rows.map(toPublicUser);
  }

  async updateMe(
    userId: string,
    patch: { avatarUrl?: string | null; country?: string | null },
  ): Promise<PublicUser> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
    if (patch.country !== undefined) user.country = patch.country;
    await this.users.save(user);
    await this.invalidateProfile(userId);
    return toPublicUser(user);
  }
}

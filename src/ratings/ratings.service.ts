import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import {
  LeaderboardEntry,
  RATING_DEFAULT,
  TimeControlCategory,
} from 'chess-64-squares-shared';
import { toPublicUser } from '../auth/auth.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { RatingEntity, RatingHistoryEntity, UserEntity } from '../database/entities';

export const leaderboardKey = (category: string): string => `c64:lb:${category}`;

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(RatingEntity) private readonly ratings: Repository<RatingEntity>,
    @InjectRepository(RatingHistoryEntity)
    private readonly history: Repository<RatingHistoryEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Rating snapshot for matchmaking / game creation (creates default lazily). */
  async getOrDefault(
    userId: string,
    category: TimeControlCategory,
  ): Promise<{ rating: number; gamesPlayed: number }> {
    const row = await this.ratings.findOneBy({ userId, category });
    return row
      ? { rating: row.rating, gamesPlayed: row.gamesPlayed }
      : { rating: RATING_DEFAULT, gamesPlayed: 0 };
  }

  /**
   * Leaderboard from the Redis ZSET (maintained by the persistence worker on
   * every rating write). Falls back to Postgres and rebuilds the ZSET when
   * cold (ARCHITECTURE.md §2.7).
   */
  async leaderboard(category: TimeControlCategory, limit = 50): Promise<LeaderboardEntry[]> {
    const key = leaderboardKey(category);
    let entries: Array<{ userId: string; rating: number }> = [];

    const raw = await this.redis
      .zrevrange(key, 0, limit - 1, 'WITHSCORES')
      .catch(() => [] as string[]);
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ userId: raw[i]!, rating: Math.round(Number(raw[i + 1])) });
    }

    if (entries.length === 0) {
      const rows = await this.ratings.find({
        where: { category },
        order: { rating: 'DESC' },
        take: limit,
      });
      entries = rows.map((r) => ({ userId: r.userId, rating: r.rating }));
      if (entries.length > 0) {
        const zargs: Array<string | number> = [];
        for (const e of entries) zargs.push(e.rating, e.userId);
        await this.redis.zadd(key, ...(zargs as [number, string])).catch(() => undefined);
      }
    }

    if (entries.length === 0) return [];
    const userRows = await this.users
      .createQueryBuilder('u')
      .whereInIds(entries.map((e) => e.userId))
      .getMany();
    const ratingRows = await this.ratings
      .createQueryBuilder('r')
      .where('r.category = :category', { category })
      .andWhere('r.user_id IN (:...ids)', { ids: entries.map((e) => e.userId) })
      .getMany();
    const byId = new Map(userRows.map((u) => [u.id, u]));
    const gamesById = new Map(ratingRows.map((r) => [r.userId, r.gamesPlayed]));

    return entries
      .filter((e) => byId.has(e.userId))
      .map((e, i) => ({
        rank: i + 1,
        user: toPublicUser(byId.get(e.userId)!),
        rating: e.rating,
        gamesPlayed: gamesById.get(e.userId) ?? 0,
      }));
  }

  async ratingHistory(
    userId: string,
    category: TimeControlCategory,
    limit = 100,
  ): Promise<Array<{ rating: number; gameId: string | null; at: string }>> {
    const rows = await this.history.find({
      where: { userId, category },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows
      .reverse()
      .map((r) => ({ rating: r.rating, gameId: r.gameId, at: r.createdAt.toISOString() }));
  }
}

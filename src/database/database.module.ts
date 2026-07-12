import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { AppConfig } from '../config/configuration';
import { ALL_ENTITIES } from './entities';
import { InitSchema1752200000000 } from '../migrations/1752200000000-InitSchema';
import { EmailVerification1752300000000 } from '../migrations/1752300000000-EmailVerification';
import { Puzzles1752400000000 } from '../migrations/1752400000000-Puzzles';

/**
 * Writes go to the primary; SELECTs outside transactions are load-balanced
 * over read replicas when POSTGRES_REPLICA_HOSTS is set (ARCHITECTURE.md §2.6).
 * In dev (no replicas) everything hits the single Postgres.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): TypeOrmModuleOptions => {
        const pg = config.get('postgres', { infer: true });
        const common = {
          type: 'postgres' as const,
          entities: ALL_ENTITIES,
          migrations: [InitSchema1752200000000, EmailVerification1752300000000, Puzzles1752400000000],
          migrationsRun: config.get('runMigrations', { infer: true }),
          synchronize: false,
          autoLoadEntities: false,
          // connection pool per instance — with 60 gateway replicas keep this
          // small and put PgBouncer in front (ARCHITECTURE.md §10)
          extra: { max: 10 },
        };
        if (pg.replicaHosts.length === 0) {
          return {
            ...common,
            host: pg.host,
            port: pg.port,
            username: pg.user,
            password: pg.password,
            database: pg.db,
          };
        }
        return {
          ...common,
          replication: {
            master: {
              host: pg.host,
              port: pg.port,
              username: pg.user,
              password: pg.password,
              database: pg.db,
            },
            slaves: pg.replicaHosts.map((r) => ({
              host: r.host,
              port: r.port,
              username: pg.user,
              password: pg.password,
              database: pg.db,
            })),
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './module/auth/auth.module';
import { UserModule } from './module/user/user.module';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from './module/mail/mail.module';
import { GameModule } from './module/game/game.module';
import { PuzzleModule } from './module/puzzle/puzzle.module';
import * as fs from 'fs';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
      // ssl: {
      //   ca: fs.readFileSync('global-bundle.pem').toString(),
      // },
    }),
    AuthModule,
    MailModule,
    UserModule,
    GameModule,
    PuzzleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PasswordResetTokenEntity,
  RefreshTokenEntity,
  UserEntity,
} from '../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity, PasswordResetTokenEntity]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

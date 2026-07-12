import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerificationTokenEntity, UserEntity } from '../database/entities';
import { EmailVerificationService } from './email-verification.service';
import { emailSenderProvider } from './email.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, EmailVerificationTokenEntity])],
  providers: [emailSenderProvider, EmailVerificationService],
  exports: [EmailVerificationService],
})
export class EmailModule {}

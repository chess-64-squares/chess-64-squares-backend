import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  constructor(private readonly configService: ConfigService) {}

  private createTransporter() {
    return nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: Number(this.configService.get<string>('MAIL_PORT')),
      secure: false,
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASSWORD'),
      },
    });
  }

  async sendVerifyEmail(email: string, token: string) {
    const appUrl =
      this.configService.get<string>('WEB_URL') ?? 'https://localhost:5173';

    const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const transporter = this.createTransporter();

    try {
      await transporter.sendMail({
        from: this.configService.get<string>('MAIL_FROM'),
        to: email,
        subject: 'Verify your Chess 64 Squares account',
        html: `
          <h2>Verify your account</h2>
          <p>Click the link below to verify your email:</p>
          <a href="${verifyUrl}">${verifyUrl}</a>
          <p>This link expires in 15 minutes.</p>
        `,
      });
    } catch {
      throw new InternalServerErrorException('Can not send verification email');
    }
  }
}

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
    const appUrl = this.configService.get<string>('APP_URL');

    const verifyUrl = `${appUrl}/api/v1/auth/verify-email?token=${token}`;

    const transporter = this.createTransporter();

    try {
      await transporter.sendMail({
        from: this.configService.get<string>('MAIL_FROM'),
        to: email,
        subject: 'Verify your Chess 64 Squares account',
        html: `
          <h2>Xác thực tài khoản</h2>
          <p>Vui lòng bấm vào link bên dưới để xác thực email:</p>
          <a href="${verifyUrl}">${verifyUrl}</a>
          <p>Link này sẽ hết hạn sau 15 phút.</p>
        `,
      });
    } catch (error) {
      throw new InternalServerErrorException('Can not send verification email');
    }
  }
}
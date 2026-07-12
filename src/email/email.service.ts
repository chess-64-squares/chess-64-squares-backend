import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/configuration';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Swappable email delivery port (prompt-02 §2). Provider choice: NODEMAILER
 * over SMTP — it speaks to every transactional service (SendGrid, Postmark,
 * SES, Mailgun all expose SMTP endpoints), so "swapping providers" is an env
 * change, not a code change. When SMTP_HOST is unset (local dev), the dev-log
 * sender prints the full email + link to the backend log so the flow is
 * testable without live delivery.
 */
export abstract class EmailSender {
  abstract send(email: OutgoingEmail): Promise<void>;
}

@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const email = config.get('email', { infer: true });
    this.from = email.fromAddress;
    this.transporter = createTransport({
      host: email.smtpHost,
      port: email.smtpPort,
      secure: email.smtpPort === 465,
      auth:
        email.smtpUser && email.smtpPassword
          ? { user: email.smtpUser, pass: email.smtpPassword }
          : undefined,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...email });
    this.logger.log(`sent "${email.subject}" to ${email.to}`);
  }
}

@Injectable()
export class DevLogEmailSender extends EmailSender {
  private readonly logger = new Logger(DevLogEmailSender.name);

  async send(email: OutgoingEmail): Promise<void> {
    this.logger.log(
      `[DEV EMAIL — no SMTP configured] to=${email.to} subject="${email.subject}"\n${email.text}`,
    );
  }
}

/** DI factory: SMTP when configured, dev-log otherwise. */
export const emailSenderProvider = {
  provide: EmailSender,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): EmailSender => {
    const email = config.get('email', { infer: true });
    return email.smtpHost ? new SmtpEmailSender(config) : new DevLogEmailSender();
  },
};

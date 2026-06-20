import { IsEmail, IsOptional, IsString } from 'class-validator';

export class VerifyEmailReqDto {
  @IsOptional()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  otp: string;

  @IsOptional()
  @IsString()
  token?: string;
}

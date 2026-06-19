import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class VerifyEmailReqDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsString()
    otp: string;
}
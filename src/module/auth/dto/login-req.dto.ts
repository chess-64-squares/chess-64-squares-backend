import { IsNotEmpty, IsString } from "class-validator";

export class LoginReqDto {
  @IsNotEmpty()
  @IsString()
  username: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}
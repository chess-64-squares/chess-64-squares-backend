import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { LoginReqDto, LoginResDto, RegisterReqDto, VerifyEmailReqDto, } from './dto'
import { AuthService } from './auth.service';
import { ApiResponse } from '../../common/response/api-response';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  async register(@Body() registerReqDto: RegisterReqDto): Promise<any> {
    return this.authService.register(registerReqDto);
  }

  @Post('login')
  async login(@Body() loginReqDto: LoginReqDto): Promise<ApiResponse<LoginResDto>> {
    return this.authService.login(loginReqDto);
  }

  @Post('verify-email')
  async verifyEmail(@Body() verifyEmailReqDto: VerifyEmailReqDto) {
    return this.authService.verifyEmail(verifyEmailReqDto);
  }
}
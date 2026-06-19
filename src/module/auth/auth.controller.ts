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
  async register(@Body() registerReqDto: RegisterReqDto): Promise<ApiResponse<void>> {
    await this.authService.register(registerReqDto);
    return ApiResponse.success(null, 'User registered successfully. Please verify your email.');
  }

  @Post('login')
  async login(@Body() loginReqDto: LoginReqDto): Promise<ApiResponse<LoginResDto>> {
    const loginRes = await this.authService.login(loginReqDto);
    return ApiResponse.success(loginRes, 'Successfully');
  }

  @Post('verify-email')
  async verifyEmail(@Body() verifyEmailReqDto: VerifyEmailReqDto): Promise<ApiResponse<void>> {
    await this.authService.verifyEmail(verifyEmailReqDto);
    return ApiResponse.success(null, 'Email verified successfully');
  }
}
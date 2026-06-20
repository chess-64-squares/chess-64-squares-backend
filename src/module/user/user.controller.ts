import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { UserService } from "./user.service";
import { AuthGuard } from "@nestjs/passport";
import { ApiResponse } from "../../common/response/api-response";
import { UserResDto } from "./dto/user-res.dto";

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) { }

    @Get('profile')
    @UseGuards(AuthGuard('jwt'))
    async getProfile(@Req() req: any): Promise<ApiResponse<UserResDto>> {
        const userRes = await this.userService.getProfile(Number(req.user.sub));
        return ApiResponse.success(userRes);
    }

    @Get('profile/:username')
    async getProfileByUsername(@Param('username') username: string): Promise<ApiResponse<UserResDto>> {
        const userRes = await this.userService.getProfileByUsername(username);
        return ApiResponse.success(userRes);
    }
}

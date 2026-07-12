import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedUser } from './jwt-payload';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

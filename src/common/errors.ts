import { HttpException, HttpStatus } from '@nestjs/common';

/** 429 — @nestjs/common has no built-in for it. */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests') {
    super(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

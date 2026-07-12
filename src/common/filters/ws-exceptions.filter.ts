import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { GameActionError, WsError } from 'chess-64-squares-shared';
import type { Socket } from 'socket.io';

/**
 * Safety net for gateways: any exception escaping a handler becomes a
 * structured `error` event on the offending socket — an unhandled exception
 * must never tear down the gateway or the connection.
 */
@Catch()
export class WsExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsExceptionsFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    let payload: WsError;
    if (exception instanceof GameActionError) {
      payload = { code: exception.code, message: exception.message };
    } else if (exception instanceof WsException) {
      const err = exception.getError();
      payload =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as WsError)
          : { code: 'VALIDATION', message: String(err) };
    } else {
      this.logger.error({ err: exception }, 'Unhandled gateway exception');
      payload = { code: 'INTERNAL', message: 'Internal error' };
    }

    client.emit('error', payload);
  }
}

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { createSocketAuthMiddleware } from './module/game/middleware/socket-auth.middleware';

class AuthenticatedIoAdapter extends IoAdapter {
  constructor(
    private readonly app: INestApplication,
    private readonly jwtService: JwtService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: '*', // thay bằng domain frontend khi deploy
      },
    }) as Server;

    server.of('/game').use(createSocketAuthMiddleware(this.jwtService));

    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(process.env.API_PREFIX || 'api/v1');
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const jwtService = app.get(JwtService);
  app.useWebSocketAdapter(new AuthenticatedIoAdapter(app, jwtService));

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();

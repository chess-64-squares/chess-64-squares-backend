import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { createSocketAuthMiddleware } from './module/game/middleware/socket-auth.middleware';

class AuthenticatedIoAdapter extends IoAdapter {
    constructor(
        private readonly app: any,
        private readonly jwtService: JwtService,
    ) {
        super(app);
    }

    createIOServer(port: number, options?: any) {
        const server = super.createIOServer(port, {
            ...options,
            cors: {
                origin: '*', // thay bằng domain frontend khi deploy
            },
        });

        server.of('/game').use(createSocketAuthMiddleware(this.jwtService));

        return server;
    }
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.setGlobalPrefix(process.env.API_PREFIX || 'api/v1');

    const jwtService = app.get(JwtService);
    app.useWebSocketAdapter(new AuthenticatedIoAdapter(app, jwtService));

    await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
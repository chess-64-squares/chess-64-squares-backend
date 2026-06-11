import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) { }

    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email },
        });
    }

    async findById(userId: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { userId },
        });
    }

    async create(data: Partial<User>): Promise<User> {
        const user = this.userRepository.create(data);
        return this.userRepository.save(user);
    }

    async updateEmailVerified(userId: string) {
        await this.userRepository.update(userId, { isEmailVerified: true });
    }
}
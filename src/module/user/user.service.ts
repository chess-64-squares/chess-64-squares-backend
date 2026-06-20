import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';
import { UserResDto } from './dto';
import { AppException, ErrorCode } from '../../common/exceptions';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username },
    });
  }

  async findById(userId: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { userId },
    });
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  async updateEmailVerified(userId: number) {
    await this.userRepository.update(userId, { isEmailVerified: true });
  }

  async updateElo(userId: number, elo: number): Promise<void> {
    await this.userRepository.update(userId, { elo });
  }

  async getProfile(userId: number): Promise<UserResDto> {
    const user = await this.userRepository.findOne({
      where: { userId },
    });
    if (!user)
      throw new AppException(ErrorCode.USER_NOT_FOUND, 'User not found');

    return user;
  }

  async getProfileByUsername(username: string): Promise<UserResDto> {
    const user = await this.userRepository.findOne({
      where: { username },
      select: ['username', 'elo', 'status', 'createdAt'],
    });
    if (!user)
      throw new AppException(ErrorCode.USER_NOT_FOUND, 'User not found');
    return user;
  }
}

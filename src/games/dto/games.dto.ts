import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const TIME_CONTROL_PATTERN = /^\d{1,3}(\+|d)\d{1,3}$/;

export class CreateBotGameDto {
  @IsInt()
  @Min(1)
  @Max(8)
  level!: number;

  @IsOptional()
  @IsString()
  @Matches(TIME_CONTROL_PATTERN)
  timeControlId?: string;

  @IsOptional()
  @IsIn(['w', 'b', 'random'])
  color?: 'w' | 'b' | 'random';
}

export class CreateInviteDto {
  @IsString()
  @Matches(TIME_CONTROL_PATTERN)
  timeControlId!: string;

  @IsOptional()
  @IsBoolean()
  rated?: boolean;

  @IsOptional()
  @IsIn(['w', 'b', 'random'])
  color?: 'w' | 'b' | 'random';
}

export class ChallengeFriendDto {
  @IsUUID()
  toUserId!: string;

  @IsString()
  @Matches(TIME_CONTROL_PATTERN)
  timeControlId!: string;

  @IsOptional()
  @IsBoolean()
  rated?: boolean;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

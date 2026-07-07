import { IsBoolean } from 'class-validator';

export class RecordAttemptReqDto {
  @IsBoolean()
  solved: boolean;
}

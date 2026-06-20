export class ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  errorCode?: string;
  timeStamp: string = new Date().toISOString();

  constructor(
    success: boolean,
    message: string,
    data: T | null = null,
    errorCode?: string,
  ) {
    this.success = success;
    this.message = message;
    this.data = data;
    this.errorCode = errorCode;
  }

  static success<T>(data: T, message = 'Success'): ApiResponse<T> {
    return new ApiResponse<T>(true, message, data);
  }

  static error(message: string, errorCode?: string): ApiResponse<null> {
    return new ApiResponse<null>(false, message, null, errorCode);
  }
}

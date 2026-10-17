export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'PRECONDITION_FAILED';

/** An expected failure with a message that is safe to show the user. Anything else is a bug and goes to error tracking. */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
};

export const badRequest = (message: string) => new AppError('BAD_REQUEST', message);
export const unauthorized = (message = 'Sign in required') => new AppError('UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError('FORBIDDEN', message);
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (message: string) => new AppError('CONFLICT', message);
export const tooManyRequests = (message: string) => new AppError('TOO_MANY_REQUESTS', message);
export const preconditionFailed = (message: string) => new AppError('PRECONDITION_FAILED', message);

export class AppError extends Error { constructor(message, status = 500, code = 'INTERNAL_ERROR') { super(message); this.status = status; this.code = code; } }
export class ValidationError extends AppError { constructor(message) { super(message, 400, 'VALIDATION_ERROR'); } }
export class AuthenticationError extends AppError { constructor(message = 'Authentication required') { super(message, 401, 'AUTHENTICATION_ERROR'); } }
export class AuthorizationError extends AppError { constructor(message = 'You do not have permission to access this resource') { super(message, 403, 'AUTHORIZATION_ERROR'); } }
export class NotFoundError extends AppError { constructor(message = 'Not found') { super(message, 404, 'NOT_FOUND'); } }
export class ConflictError extends AppError { constructor(message = 'Conflict') { super(message, 409, 'CONFLICT'); } }
export class DatabaseError extends AppError { constructor() { super('The service is temporarily unavailable.', 503, 'DATABASE_ERROR'); } }

export function toErrorResponse(error) {
  if (error?.message === 'PAYLOAD_TOO_LARGE') return { status: 413, body: { error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' } };
  if (error?.message === 'INVALID_JSON') return { status: 400, body: { error: 'Request body must be valid JSON.', code: 'INVALID_JSON' } };
  if (error instanceof AppError) return { status: error.status, body: { error: error.message, code: error.code } };
  return { status: 500, body: { error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' } };
}

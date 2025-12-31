// Types from com03-ErrorHandling

export type ErrorCode =
  | 'NETWORK_ERROR'
  | 'CORS_BLOCKED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'QUERY_ERROR'
  | 'PARSE_ERROR'
  | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  message: string
  details?: string
  recoveryAction?: RecoveryAction
  timestamp: string
}

export type RecoveryAction =
  | { type: 'retry' }
  | { type: 'configure'; target: 'endpoint' | 'auth' }
  | { type: 'refresh' }
  | { type: 'dismiss' }

export interface LoadingState {
  [key: string]: boolean
}

import type { AccountRole, SessionPrincipal } from './types.ts';

export class AuthorizationError extends Error {
  public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN';
  public readonly statusCode: 401 | 403;

  public constructor(
    code: 'UNAUTHENTICATED' | 'FORBIDDEN',
    statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function requireAuthenticated(principal: SessionPrincipal | null): SessionPrincipal {
  if (principal === null) {
    throw new AuthorizationError('UNAUTHENTICATED', 401, 'Authentication is required');
  }
  return principal;
}

export function requireRole(principal: SessionPrincipal, role: AccountRole): SessionPrincipal {
  if (principal.role !== role) {
    throw new AuthorizationError('FORBIDDEN', 403, 'You are not allowed to access this resource');
  }
  return principal;
}

export function requireTeamAccess(principal: SessionPrincipal, teamId: string): SessionPrincipal {
  if (principal.role === 'BTC_ADMIN' || principal.teamId === teamId) {
    return principal;
  }
  throw new AuthorizationError('FORBIDDEN', 403, 'You are not allowed to access this resource');
}

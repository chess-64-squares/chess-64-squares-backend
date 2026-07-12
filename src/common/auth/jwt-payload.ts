export interface AccessTokenPayload {
  /** user id */
  sub: string;
  username: string;
  isGuest: boolean;
}

export interface RefreshTokenPayload {
  sub: string;
  /** token id — hashed and tracked server-side for rotation/revocation */
  jti: string;
}

export interface AuthedUser {
  id: string;
  username: string;
  isGuest: boolean;
}

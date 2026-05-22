import 'express-session';

declare module 'express-session' {
  interface SessionData {
    // Only the userId is persisted in the session. The full principal is
    // resolved per request via AuthService so permission changes take effect.
    userId?: string;
  }
}

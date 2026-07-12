/** DI token in its own module to avoid circular imports with providers. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

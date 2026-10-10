process.env.DATABASE_PATH = './data/projectx-test.sqlite';
// Many tests sign in and post forms; production rate limits would block them.
process.env.DISABLE_RATE_LIMITS = 'true';

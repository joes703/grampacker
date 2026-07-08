import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', '.wrangler', 'worker-configuration.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // src/lib/api.ts is the SPA's single door to /api/*: it owns the
    // anti-CSRF header, error normalization, and DTO validation. A raw
    // fetch() call site silently skips all three (Codex finding, PR #15).
    // better-auth traffic goes through authClient, never a hand-rolled
    // fetch, so banning the identifier outright costs nothing.
    files: ['src/**'],
    ignores: ['src/lib/api.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Use apiFetch/apiFetchVoid from src/lib/api.ts - raw fetch skips the CSRF header, error normalization, and DTO validation.',
        },
        {
          selector:
            "CallExpression[callee.property.name='fetch'][callee.object.name='window']",
          message:
            'Use apiFetch/apiFetchVoid from src/lib/api.ts - raw fetch skips the CSRF header, error normalization, and DTO validation.',
        },
      ],
    },
  },
  {
    // Security-by-construction import boundary (REWRITE_PLAN.md section 5):
    // handlers receive user-scoped repositories from c.get('repos'),
    // attached by requireSession. They must not reach the DB, the schema,
    // or auth directly. Fail closed: the boundary covers ALL server code;
    // the data layer, middleware, composition root, and tests are the only
    // exemptions, listed explicitly below. A new server directory is inside
    // the boundary by default.
    //
    // Known residual (accepted): a specifier-based lint cannot follow
    // re-exports, so an exempted module could launder a forbidden import.
    // The exempt list is small and reviewed; this rule is drift protection,
    // not a sandbox.
    files: ['server/**'],
    ignores: [
      'server/db/**', // owns the schema and the drizzle factory
      'server/repos/**', // the only constructor of scoped data access
      'server/middleware/**', // builds repos/session, hands them to handlers
      'server/auth.ts', // better-auth wiring, consumed via middleware
      'server/auth-schema.config.ts', // CLI-only schema generator config
      'server/index.ts', // composition root: mounts auth, /health db ping
      'server/test/**', // test helpers seed the DB directly
      'server/**/*.test.ts',
    ],
    linterOptions: {
      // The boundary cannot be waived with eslint-disable comments.
      noInlineConfig: true,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db', '**/db/**', 'drizzle-orm', 'drizzle-orm/**'],
              message:
                "Route handlers must not touch the database or schema. Use the scoped repositories from c.get('repos').",
            },
            {
              group: ['**/repos', '**/repos/**'],
              allowTypeImports: true,
              message:
                "Only the session middleware constructs repositories. Handlers read them from c.get('repos'); type-only imports are allowed.",
            },
            {
              group: ['**/auth', 'better-auth', 'better-auth/**', '@better-auth/**'],
              message:
                'Auth is mounted in server/index.ts and consumed via requireSession. Handlers must not call better-auth directly.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            'Dynamic import() is invisible to the import boundary. Use static imports in server code.',
        },
      ],
    },
  },
)

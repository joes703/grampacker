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
    // Security-by-construction import boundary (REWRITE_PLAN.md section 5):
    // route handlers receive user-scoped repositories from c.get('repos'),
    // attached by requireSession. They must not be able to reach the DB,
    // the schema, or auth directly - the repository layer and middleware
    // are the only importers. server/index.ts (composition root) and the
    // middleware/repo layers are intentionally outside this boundary.
    files: ['server/routes/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db', '**/db/**', 'drizzle-orm', 'drizzle-orm/*'],
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
              group: ['**/auth', 'better-auth', 'better-auth/*', '@better-auth/*'],
              message:
                'Auth is mounted in server/index.ts and consumed via requireSession. Handlers must not call better-auth directly.',
            },
          ],
        },
      ],
    },
  },
)

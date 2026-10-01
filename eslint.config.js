import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', '.wrangler', '.superpowers', 'worker-configuration.d.ts'] },
  ...tseslint.configs.recommended,
  {
    // A dropped promise in a Worker is a silently swallowed error (and
    // on the SPA side, a mutation nobody observes). tsc does not catch
    // these; only the type-aware lint rule does. Scoped to source files
    // covered by the tsconfigs - the flat-config files themselves are
    // plain JS and stay outside the type-checked program.
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
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
            "Use apiFetch/apiFetchVoid from src/lib/api.ts - raw fetch skips the CSRF header, error normalization, and DTO validation.",
        },
        // Every useMutation carries a mutationKey from src/lib/queries/keys.ts.
        // Without one, mutation-error-handler logs `[mutation] failed` with an
        // empty payload - which was true of 38 of the app's 39 mutations before
        // PR 4.4.
        //
        // Three selectors, because one has holes. A textual scan was tried first
        // and rejected: src/lib/queries/optimistic.ts contains `useMutation({`
        // inside COMMENTS, so prose can satisfy a grep while an executable call
        // goes unkeyed. Comments are not AST nodes, so this cannot happen here.
        {
          // Also catches `useMutation(opts)` - options hoisted into a variable
          // hide the key from review as effectively as omitting it.
          selector:
            "CallExpression[callee.name='useMutation']:not(:has(ObjectExpression > Property[key.name='mutationKey']))",
          message:
            'useMutation needs an inline `mutationKey:` from mutationKeys (src/lib/queries/keys.ts).',
        },
        {
          // rq.useMutation(...) - a member call renames the callee out of the
          // selector above.
          selector: "CallExpression[callee.property.name='useMutation']",
          message:
            'Call useMutation as a bare named import so the mutationKey rule can see it.',
        },
        {
          // An aliased import does the same thing by another route.
          selector:
            "ImportSpecifier[imported.name='useMutation'][local.name!='useMutation']",
          message:
            'Do not alias useMutation - the mutationKey rule matches on the callee name.',
        },
      ],
    },
  },
  {
    // Security-by-construction import boundary (SECURITY.md, "Authorization boundary"):
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
  // Node-tier server tests (docs/testing-and-ci.md section 3) run on plain
  // Node, which refuses `cloudflare:*` at import on its own. The one thing
  // Node does not refuse is the app entry: server/index.ts loads fine there,
  // so a misnamed API test would prove Hono-on-Node instead of workerd.
  //
  // One block per directory depth, 0-5 (server/ is 4 deep today), so each file
  // forbids the direct spellings that reach server/index.ts from where it
  // sits - and not a sibling index.ts, such as server/email/index.ts. A
  // roundabout path (../../server/index) still gets through.
  ...[0, 1, 2, 3, 4, 5].map((depth) => {
    const dir = depth === 0 ? '.' : Array(depth).fill('..').join('/')
    return {
      files: [`server/${'*/'.repeat(depth)}*.node.test.ts`],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [dir, `${dir}/`, `${dir}/index`, `${dir}/index.ts`, `${dir}/index.js`].map((name) => ({
              name,
              message:
                'A .node.test.ts runs on Node and must not drive the app. Name it .test.ts to run it on workerd.',
            })),
          },
        ],
      },
    }
  }),
)

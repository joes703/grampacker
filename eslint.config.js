import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  jsxA11y.flatConfigs.recommended,
  {
    rules: {
      // autoFocus is used throughout the app on dialogs and inline-edit
      // inputs that open in direct response to a user gesture (click/tap to
      // open). The WCAG concern (auto-focus on page load) doesn't apply —
      // focus is the expected continuation of the user's action. Replacing
      // each site with useEffect+ref.focus() would be mechanically equivalent
      // and less readable.
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  prettierConfig,
)

import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['out/**', 'release/**', 'node_modules/**', 'coverage/**', 'test-results/**']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs', '*.config.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/workers/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Plain Node build scripts: no types to check, so the type-aware rules are off rather than
    // worked around with casts.
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/preload/**/*.ts', 'src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The house rule from CLAUDE.md and ADR 0004 C, enforced by the linter rather than by
    // review: the WhatsApp bridge is read-only, and the one send path lives in a single module.
    files: ['src/**/*.ts'],
    ignores: ['src/main/outgoing/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression > MemberExpression[property.name=/^(sendMessage|sendText|sendSeen|markComposing|deleteMessage|revokeMessage|blockContact|addParticipant|removeParticipant|setSubject|sendReaction)$/]',
          message:
            'Write access to WhatsApp is forbidden (CLAUDE.md, ADR 0004 C). The only send path is src/main/outgoing/.',
        },
      ],
    },
  },
])

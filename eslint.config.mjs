import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default defineConfig([
  globalIgnores([
    'out/**',
    'release/**',
    'node_modules/**',
    'coverage/**',
    'test-results/**',
    // Standalone measurement artefacts: browser and extension scripts that run under
    // Chromium, not under this project's TypeScript config. They are kept verbatim as the
    // record of what was measured, so linting them to project rules would be beside the point.
    'spikes/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            '*.config.mjs',
            'scripts/*.mjs',
            'scripts/lib/*.mjs',
          ],
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
    // The utilityProcess workers must stay importable as plain Node, so they can be unit-tested
    // without an Electron mock. They reach the host through process.parentPort, which Electron
    // provides at runtime without an import.
    files: ['src/workers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'Workers stay Electron-free so they can be tested as plain Node. Use the MessagePort the host hands over.',
            },
          ],
        },
      ],
    },
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
    // House rules from CLAUDE.md, enforced by the linter rather than by review: nothing anywhere
    // opens a listening socket, and the WhatsApp bridge is read-only with exactly one send path
    // (ADR 0004 C).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // A listening socket triggers a Windows Firewall prompt, and dismissing that prompt
          // needs administrator rights — which this project does not have and will not ask for.
          selector: "CallExpression > MemberExpression[property.name='listen']",
          message:
            'No listening sockets (CLAUDE.md, "Keine Adminrechte"). A firewall prompt needs admin rights.',
        },
        {
          selector: 'CallExpression > MemberExpression[property.name=/^create(Server|Socket)$/]',
          message:
            'No servers or raw sockets (CLAUDE.md, "Keine Adminrechte"). Only WhatsApp and GitHub Releases.',
        },
        {
          selector: 'CallExpression[callee.name=/^create(Server|Socket)$/]',
          message:
            'No servers or raw sockets (CLAUDE.md, "Keine Adminrechte"). Only WhatsApp and GitHub Releases.',
        },
      ],
    },
  },
  {
    // Everywhere except the one module allowed to type into WhatsApp's visible composer.
    files: ['src/**/*.ts'],
    ignores: ['src/main/outgoing/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // A listening socket triggers a Windows Firewall prompt, and dismissing that prompt
          // needs administrator rights — which this project does not have and will not ask for.
          selector: "CallExpression > MemberExpression[property.name='listen']",
          message:
            'No listening sockets (CLAUDE.md, "Keine Adminrechte"). A firewall prompt needs admin rights.',
        },
        {
          selector: 'CallExpression > MemberExpression[property.name=/^create(Server|Socket)$/]',
          message:
            'No servers or raw sockets (CLAUDE.md, "Keine Adminrechte"). Only WhatsApp and GitHub Releases.',
        },
        {
          selector: 'CallExpression[callee.name=/^create(Server|Socket)$/]',
          message:
            'No servers or raw sockets (CLAUDE.md, "Keine Adminrechte"). Only WhatsApp and GitHub Releases.',
        },
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

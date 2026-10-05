import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// House rules from CLAUDE.md, enforced by the linter rather than by review.
const NO_SOCKETS = [
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
]

// The WhatsApp bridge is read-only with exactly one send path (ADR 0004 C).
const NO_WHATSAPP_WRITES = {
  selector:
    'CallExpression > MemberExpression[property.name=/^(sendMessage|sendText|sendSeen|markComposing|deleteMessage|revokeMessage|blockContact|addParticipant|removeParticipant|setSubject|sendReaction)$/]',
  message:
    'Write access to WhatsApp is forbidden (CLAUDE.md, ADR 0004 C). The only send path is src/main/outgoing/.',
}

// The one file in the browser extension that talks to other extension contexts.
const EXTENSION_MESSAGING = 'src/extension/ext.ts'

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
    files: ['src/preload/**/*.ts', 'src/renderer/**/*.{ts,tsx}', 'src/extension/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The send module itself still may not open sockets.
    files: ['src/main/outgoing/**'],
    rules: { 'no-restricted-syntax': ['error', ...NO_SOCKETS] },
  },
  {
    // Everywhere except the one module allowed to type into WhatsApp's visible composer.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/main/outgoing/**', EXTENSION_MESSAGING],
    rules: {
      'no-restricted-syntax': ['error', ...NO_SOCKETS, NO_WHATSAPP_WRITES],
    },
  },
  {
    // The browser extension's own messaging (runtime/tabs.sendMessage) is IPC between extension
    // contexts, not a write into WhatsApp — but it shares the method name the rule above guards.
    // It is allowed in exactly one file, and only on `runtime` and `tabs`: a `sendMessage` on
    // anything else is still refused here too (ADR 0010).
    files: [EXTENSION_MESSAGING],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...NO_SOCKETS,
        {
          ...NO_WHATSAPP_WRITES,
          selector: `${NO_WHATSAPP_WRITES.selector}:not([object.property.name=/^(runtime|tabs)$/])`,
        },
      ],
    },
  },
])

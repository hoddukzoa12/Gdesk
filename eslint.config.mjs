import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out',
      'dist',
      'release',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      '.dryforge'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    // 화면(렌더러)은 격리된다: Node·Electron 기능을 직접 import 하지 않는다(spec 11-2).
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: ['electron', 'fs', 'path', 'child_process', 'os', 'crypto'],
          patterns: ['node:*', '@main/*', '**/main/**']
        }
      ]
    }
  }
)

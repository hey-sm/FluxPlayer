import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'scripts/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-glass-ui',
              message: '业务代码必须通过 @/components/glass 统一包装层使用玻璃组件。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/src/components/glass/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)

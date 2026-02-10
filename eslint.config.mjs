// eslint-disable-next-line import/no-unresolved
import graphqlPlugin from '@graphql-eslint/eslint-plugin';
import openCollectiveConfig from 'eslint-config-opencollective/eslint-node.config.cjs';

export default [
  ...openCollectiveConfig,
  // Global ignores
  {
    ignores: ['**/node_modules/', '*.journal'],
  },
  {
    files: ['**/*.js'],
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      'n/no-process-exit': 'off',
      'n/hashbang': 'off',
      'n/prefer-node-protocol': 'error',
      'no-console': 'off',
      // Sort node: builtins before npm packages
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000'],
            ['^node:'],
            ['^@?\\w'],
            ['^[^.]'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
          ],
        },
      ],
    },
  },
  // Extract GraphQL operations from /* GraphQL */ template literals in JS files
  {
    files: ['**/*.js'],
    processor: graphqlPlugin.processor,
  },
  // Lint extracted GraphQL operations against the schema
  {
    files: ['**/*.js/*.graphql'],
    languageOptions: {
      parser: graphqlPlugin.parser,
      parserOptions: {
        graphQLConfig: {
          schema: 'graphql/schemaV2.graphql',
        },
      },
    },
    plugins: {
      '@graphql-eslint': graphqlPlugin,
    },
    rules: {
      '@graphql-eslint/known-type-names': 'error',
      '@graphql-eslint/fields-on-correct-type': 'error',
      '@graphql-eslint/no-duplicate-fields': 'error',
      '@graphql-eslint/no-undefined-variables': 'error',
      '@graphql-eslint/no-unused-variables': 'warn',
    },
  },
  // Lint .graphql schema files
  {
    files: ['**/*.graphql'],
    languageOptions: {
      parser: graphqlPlugin.parser,
    },
    plugins: {
      '@graphql-eslint': graphqlPlugin,
    },
    rules: {
      '@graphql-eslint/known-type-names': 'error',
      '@graphql-eslint/no-duplicate-fields': 'error',
    },
  },
];

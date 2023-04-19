module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true,
  },
  ignorePatterns: ['dist'],
  extends: ['@offchainlabs/eslint-config-typescript/base'],
  rules: {
    'no-await-in-loop': 'off',
  },
  parserOptions: {
    ecmaVersion: 2018, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
  },
};

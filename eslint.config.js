import tseslint from 'typescript-eslint';

// Regras de segurança do SDD (SEG-03, SEG-08, SEG-14): conteúdo de log é entrada hostil.
// Nada de APIs que interpretam HTML ou código a partir de texto.
const restritos = [
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'SEG-03: proibido atribuir innerHTML/outerHTML. Use nós de texto.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'SEG-03: proibido insertAdjacentHTML.',
  },
  {
    selector:
      "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: 'SEG-03: proibido document.write.',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'SEG-03: proibido dangerouslySetInnerHTML.',
  },
  {
    selector: "CallExpression[callee.name='importScripts']",
    message: 'SEG-08: proibido importScripts.',
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(readText|read)$/][callee.object.property.name='clipboard']",
    message: 'SEG-14: a área de transferência é somente escrita.',
  },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...restritos],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
);

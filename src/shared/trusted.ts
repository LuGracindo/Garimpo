// Política Trusted Types para criar Workers (CSP: require-trusted-types-for 'script').
// Com Trusted Types ativo, `new Worker(url)` exige um TrustedScriptURL; a política "garimpo-worker"
// só aceita URLs da mesma origem, e a CSP permite apenas esse nome. Vale na página e nos Workers.

interface TrustedTypesApi {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): { createScriptURL(input: string): unknown };
}

type Policy = { createScriptURL(input: string): unknown };
let cached: Policy | null = null;

export function createScriptUrl(url: string): string {
  const scope = globalThis as unknown as {
    trustedTypes?: TrustedTypesApi;
    location: { href: string; origin: string };
  };
  const api = scope.trustedTypes;
  if (!api) return url;

  // Uma política com o mesmo nome só pode ser criada uma vez por contexto.
  cached ??= api.createPolicy('garimpo-worker', {
    createScriptURL: (input) => {
      const resolved = new URL(input, scope.location.href);
      if (resolved.origin !== scope.location.origin) {
        throw new TypeError('URL de Worker fora da origem do aplicativo.');
      }
      return resolved.href;
    },
  });
  return cached.createScriptURL(url) as unknown as string;
}

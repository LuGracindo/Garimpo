// Autoteste do selo "Lacrado" (SDD 9.8 e SEG-02).
// O selo não é decoração: tenta uma requisição de rede inofensiva e espera que a CSP
// (connect-src 'none') a bloqueie, o que dispara o evento securitypolicyviolation.
// O domínio .invalid nunca resolve (RFC 2606), então, mesmo sem CSP, nada é enviado a ninguém.

export type SealState = 'testando' | 'lacrado' | 'sem-lacre';

const PROBE_HOST = 'lacre-teste.garimpo.invalid';
const PROBE_URL = `https://${PROBE_HOST}/sonda`;

export function runSealSelfTest(timeoutMs = 1500): Promise<SealState> {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (state: SealState): void => {
      if (finished) return;
      finished = true;
      document.removeEventListener('securitypolicyviolation', onViolation);
      window.clearTimeout(timer);
      resolve(state);
    };

    const onViolation = (event: Event): void => {
      const violation = event as SecurityPolicyViolationEvent;
      const blocked = violation.blockedURI ?? '';
      if (violation.effectiveDirective.startsWith('connect-src') && blocked.includes(PROBE_HOST)) {
        finish('lacrado');
      }
    };

    document.addEventListener('securitypolicyviolation', onViolation);
    const timer = window.setTimeout(() => finish('sem-lacre'), timeoutMs);

    fetch(PROBE_URL, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {
      // Esperado: bloqueada pela CSP ou sem resolução de nome. O veredito vem do evento.
    });
  });
}

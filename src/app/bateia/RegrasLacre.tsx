// Cadastro dos padrões próprios do Lacre: lista, teste ao vivo e validação de segurança.

import { useState } from 'preact/hooks';
import {
  Lacre,
  MAX_CUSTOM_RULES,
  kindOfRule,
  validateCustomRule,
  type CustomRule,
} from '../../core/lacre.ts';
import { numero } from '../format.ts';
import { t } from '../strings.ts';

interface Props {
  rules: CustomRule[];
  counts: Record<string, number> | null;
  onCustomOn: (on: boolean) => void;
  onRules: (rules: CustomRule[]) => void;
}

export function RegrasLacre({ rules, counts, onCustomOn, onRules }: Props) {
  const [nome, setNome] = useState('');
  const [rotulo, setRotulo] = useState('');
  const [padrao, setPadrao] = useState('');
  const [ignorarCaixa, setIgnorarCaixa] = useState(false);
  const [teste, setTeste] = useState('');

  const draft: CustomRule = { nome, rotulo, padrao, ignorarCaixa };
  const started = nome !== '' || rotulo !== '' || padrao !== '';
  const problem = started ? validateCustomRule(draft, rules) : null;
  const full = rules.length >= MAX_CUSTOM_RULES;
  const result =
    started && problem === null && teste !== '' ? new Lacre([], [draft]).mask(teste) : null;

  const add = (): void => {
    if (!started || problem !== null || full) return;
    onRules([...rules, { nome: nome.trim(), rotulo, padrao, ignorarCaixa }]);
    onCustomOn(true);
    setNome('');
    setRotulo('');
    setPadrao('');
    setIgnorarCaixa(false);
    setTeste('');
  };

  return (
    <section class="regras-lacre" aria-labelledby="titulo-regras-lacre">
      <h4 class="rotulo" id="titulo-regras-lacre">
        {t.lacreRegrasTitulo}
      </h4>
      <p class="nota">{t.lacreRegrasAjuda}</p>
      {rules.length === 0 ? (
        <p class="nota">{t.lacreRegrasNenhuma}</p>
      ) : (
        <ul class="lacre-tipos">
          {rules.map((rule) => {
            const found = counts ? (counts[kindOfRule(rule)] ?? 0) : null;
            return (
              <li key={rule.rotulo}>
                <span>
                  {rule.nome} · <code>&lt;{rule.rotulo}_n&gt;</code> · <code>{rule.padrao}</code>
                </span>
                <span class="lacre-n">
                  {found === null ? '…' : found === 0 ? t.lacreNada : numero.format(found)}
                  <button
                    type="button"
                    class="botao-discreto"
                    onClick={() => onRules(rules.filter((r) => r.rotulo !== rule.rotulo))}
                  >
                    {t.lacreRegraRemover}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {full ? (
        <p class="nota">{t.lacreRegraLimite}</p>
      ) : (
        <div class="regra-form">
          <label class="campo">
            <span>{t.lacreRegraNome}</span>
            <input
              type="text"
              maxLength={40}
              value={nome}
              onInput={(e) => setNome(e.currentTarget.value)}
            />
          </label>
          <label class="campo">
            <span>{t.lacreRegraRotulo}</span>
            <input
              type="text"
              maxLength={20}
              value={rotulo}
              spellcheck={false}
              onInput={(e) => setRotulo(e.currentTarget.value.toUpperCase())}
            />
          </label>
          <label class="campo">
            <span>{t.lacreRegraPadrao}</span>
            <input
              type="text"
              maxLength={200}
              value={padrao}
              spellcheck={false}
              autocomplete="off"
              onInput={(e) => setPadrao(e.currentTarget.value)}
            />
          </label>
          <label class="caixa">
            <input
              type="checkbox"
              checked={ignorarCaixa}
              onChange={(e) => setIgnorarCaixa(e.currentTarget.checked)}
            />
            <span>{t.lacreRegraIgnorar}</span>
          </label>
          <label class="campo">
            <span>{t.lacreRegraTeste}</span>
            <input
              type="text"
              value={teste}
              spellcheck={false}
              onInput={(e) => setTeste(e.currentTarget.value)}
            />
          </label>
          {problem !== null ? (
            <p class="erro" role="alert">
              {t.lacreRegraProblemas[problem]}
            </p>
          ) : null}
          {result !== null ? (
            <p class="nota" role="status">
              {t.lacreRegraResultado}: <code>{result}</code>
            </p>
          ) : null}
          <div class="acoes">
            <button
              type="button"
              class="botao"
              disabled={!started || problem !== null}
              onClick={add}
            >
              {t.lacreRegraAdicionar}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

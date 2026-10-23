// Painel de atalhos (SDD 9.4), como diálogo modal: foco entra no botão Fechar e volta para quem
// abriu. Esc fecha. Também é onde se desligam os atalhos de uma tecla.

import { useEffect, useRef } from 'preact/hooks';
import { t } from '../strings.ts';

interface Props {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onClose: () => void;
}

const LINHAS: [string, string][] = [
  ['/', t.atalhoBusca],
  ['j / k', t.atalhoPepitas],
  ['Enter', t.atalhoAbrir],
  ['[ / ]', t.atalhoOcorrencia],
  ['f', t.atalhoFiltros],
  ['e', t.atalhoLaudo],
  ['?', t.atalhoAtalhos],
  ['Esc', t.atalhoEsc],
];

export function Atalhos({ enabled, onToggle, onClose }: Props) {
  const close = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const before = document.activeElement;
    close.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      // Mantém o foco dentro do diálogo.
      const items = Array.from(
        event.currentTarget instanceof HTMLElement
          ? event.currentTarget.querySelectorAll<HTMLElement>('button, input')
          : [],
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div class="fundo-dialogo" onClick={onClose}>
      <div
        class="dialogo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-atalhos"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 class="cartao-titulo" id="titulo-atalhos">
          {t.atalhosTitulo}
        </h2>
        <table class="tabela-atalhos">
          <thead>
            <tr>
              <th scope="col">{t.tecla}</th>
              <th scope="col">{t.acao}</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map(([tecla, acao]) => (
              <tr key={tecla}>
                <td>
                  <kbd>{tecla}</kbd>
                </td>
                <td>{acao}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label class="caixa">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.currentTarget.checked)}
          />
          <span>{t.atalhosAtivos}</span>
        </label>
        <p class="nota">{t.atalhosAjuda}</p>
        <div>
          <button ref={close} type="button" class="botao" onClick={onClose}>
            {t.fechar}
          </button>
        </div>
      </div>
    </div>
  );
}

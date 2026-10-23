// Símbolo do Garimpo (SDD 2.5): a bateia vista de cima, com três arcos concêntricos (a peneira)
// e um único losango dourado deslocado do centro (a pepita).
// A cor do losango vem da classe .logo-pepita (CSS), não de atributo inline.

interface LogoProps {
  size?: number;
}

export function Logo({ size = 40 }: LogoProps) {
  return (
    <svg
      class="logo"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role="img"
      aria-label="Garimpo"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
    >
      <ellipse cx="24" cy="25" rx="20" ry="13" />
      <ellipse cx="24" cy="25" rx="14" ry="8.5" />
      <ellipse cx="24" cy="25" rx="8" ry="4.5" />
      <polygon class="logo-pepita" points="31,19 35,23.5 31,28 27,23.5" stroke="none" />
    </svg>
  );
}

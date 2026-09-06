import { useLocation } from 'preact-iso';
import { BASE_PATH } from '../utils/basePath';

const REPOSITORY_URL = 'https://github.com/deezhizyu/audio-tools';

const NAV_LINK_CLASS =
  'rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-200 hover:text-text-primary';
const NAV_LINK_ACTIVE_CLASS = 'bg-surface-overlay text-text-primary';

/** Matches the normalization preact-iso applies to `useLocation().path`, so an active nav link can be
    found by direct comparison regardless of a trailing slash on either side. */
function normalizePath(path: string): string {
  return path.replace(/\/+$/g, '') || '/';
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.333-1.755-1.333-1.755-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .319.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function WaveformLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="9" width="2" height="6" rx="1" />
      <rect x="6" y="3" width="2" height="18" rx="1" />
      <rect x="11" y="7" width="2" height="10" rx="1" />
      <rect x="16" y="1" width="2" height="22" rx="1" />
      <rect x="21" y="5" width="2" height="14" rx="1" />
    </svg>
  );
}

export function Header() {
  const { path } = useLocation();
  const silenceRemoverHref = `${BASE_PATH}/`;
  const alignmentHref = `${BASE_PATH}/alignment`;
  const roomReverbHref = `${BASE_PATH}/room-reverb`;

  return (
    <header class="border-b border-border-subtle">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-5">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-surface-base">
            <WaveformLogo />
          </div>
          <h1 class="text-sm font-semibold tracking-wide text-text-primary">Audio Tools</h1>
        </div>

        <nav class="flex items-center gap-1">
          <a
            href={silenceRemoverHref}
            class={`${NAV_LINK_CLASS} ${normalizePath(path) === normalizePath(silenceRemoverHref) ? NAV_LINK_ACTIVE_CLASS : ''}`}
          >
            Silence Remover
          </a>
          <a
            href={alignmentHref}
            class={`${NAV_LINK_CLASS} ${normalizePath(path) === normalizePath(alignmentHref) ? NAV_LINK_ACTIVE_CLASS : ''}`}
          >
            Audio Alignment
          </a>
          <a
            href={roomReverbHref}
            class={`${NAV_LINK_CLASS} ${normalizePath(path) === normalizePath(roomReverbHref) ? NAV_LINK_ACTIVE_CLASS : ''}`}
          >
            Room Reverb
          </a>
        </nav>

        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          class="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-200 hover:text-text-primary justify-self-end"
        >
          <GitHubIcon />
        </a>
      </div>
    </header>
  );
}

import { FloatingBadge } from './ui/FloatingBadge';
import { TrustPill } from './ui/TrustPill';

export function RoomReverbHero() {
  return (
    <section class="relative mx-auto mt-6 max-w-2xl px-6 pb-8 pt-14 text-center">
      <FloatingBadge class="-left-2 top-2" rotation={-8}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </FloatingBadge>
      <FloatingBadge class="-right-2 top-8" rotation={7}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5">
          <path stroke-linecap="round" d="M4 12c2-4 4-4 6 0s4 4 6 0 4-4 4-4" />
        </svg>
      </FloatingBadge>

      <h1 class="text-4xl font-bold tracking-tight text-text-primary sm:text-5xl">
        Give your audio
        <span class="block font-serif text-3xl font-normal italic text-accent sm:text-4xl [text-shadow:0_4px_14px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]">
          a real room.
        </span>
      </h1>

      <p class="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-text-secondary sm:text-base">
        Draw a room from simple boxes, place a source and a listener, and a real ray-traced acoustic
        simulation works out how that space would actually sound — then applies it to your dry audio.
      </p>

      <div class="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-text-secondary">
        <TrustPill label="Ray-traced reflections" />
        <TrustPill label="Save & reload rooms" />
        <TrustPill label="100% local" />
        <TrustPill label="Fully open-source" />
      </div>
    </section>
  );
}

import type { ComponentChildren } from 'preact';

interface SectionHeadingProps {
  title: string;
  description?: ComponentChildren;
  accentColor?: string;
}

export function SectionHeading({ title, description, accentColor }: SectionHeadingProps) {
  return (
    <div class="flex items-baseline gap-2.5">
      {accentColor && <span class="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />}
      <div>
        <h3 class="text-[0.95rem] font-semibold text-text-primary">{title}</h3>
        {description && <p class="mt-0.5 text-xs text-text-tertiary">{description}</p>}
      </div>
    </div>
  );
}

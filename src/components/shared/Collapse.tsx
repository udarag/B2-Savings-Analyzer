'use client';

import type { ReactNode } from 'react';

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** Extra classes for the outer animated wrapper. */
  className?: string;
}

/**
 * Slide-open container for drawer/expander UI.
 *
 * Children stay mounted so the open and close can both animate. Height is
 * animated with the grid-template-rows `0fr`↔`1fr` technique, which slides to
 * the natural content height without having to measure it. The inner wrapper
 * clips the content while it is collapsing. Respects prefers-reduced-motion,
 * and `inert` keeps collapsed content out of the tab order and a11y tree.
 */
export function Collapse({ open, children, className }: CollapseProps) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      } ${className ?? ''}`}
    >
      <div className="min-h-0 overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  );
}

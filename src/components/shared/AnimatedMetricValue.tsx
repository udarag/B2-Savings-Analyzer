'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from './prefersReducedMotion';

interface AnimatedMetricValueProps {
  value: number;
  /** Renders the in-flight numeric value; defaults to a rounded en-US integer. */
  formatter?: (value: number) => string;
  /** Count-up duration; 0 (or reduced-motion) snaps straight to the new value. */
  durationMs?: number;
  className?: string;
}

function defaultFormatter(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Animates a metric (savings figures, GB stored, etc.) by counting up from its
 * previous value to `value` whenever it changes, so dashboard numbers feel live
 * when the AE tweaks tier selections or pricing. Snaps instantly under
 * prefers-reduced-motion or for non-finite values.
 */
export function AnimatedMetricValue({
  value,
  formatter = defaultFormatter,
  durationMs = 650,
  className = '',
}: AnimatedMetricValueProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [updateKey, setUpdateKey] = useState(0);
  const displayValueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    // Read the start point from the ref, not state: a value change mid-animation
    // must resume from where the count-up currently sits, not from stale state.
    const startValue = displayValueRef.current;
    if (Object.is(startValue, value)) {
      return;
    }

    // Defer to the first frame so the animation timeline is anchored to a real
    // rAF timestamp. Bumping updateKey remounts the span to re-trigger the
    // one-shot CSS flourish (see metric-value-update) on each change.
    frameRef.current = window.requestAnimationFrame((firstTimestamp) => {
      setUpdateKey((current) => current + 1);

      if (!Number.isFinite(value) || !Number.isFinite(startValue) || durationMs <= 0 || prefersReducedMotion()) {
        displayValueRef.current = value;
        setDisplayValue(value);
        frameRef.current = null;
        return;
      }

      const delta = value - startValue;

      const tick = (timestamp: number) => {
        const progress = Math.min((timestamp - firstTimestamp) / durationMs, 1);
        // Ease-out cubic: decelerate toward the final number so the value settles.
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        const nextValue = startValue + delta * easedProgress;

        displayValueRef.current = nextValue;
        setDisplayValue(nextValue);

        if (progress < 1) {
          frameRef.current = window.requestAnimationFrame(tick);
        } else {
          displayValueRef.current = value;
          setDisplayValue(value);
          frameRef.current = null;
        }
      };

      tick(firstTimestamp);
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [durationMs, value]);

  const formattedValue = useMemo(() => formatter(displayValue), [displayValue, formatter]);

  return (
    <span
      key={updateKey}
      className={`inline-block tabular-nums ${updateKey > 0 ? 'metric-value-update' : ''} ${className}`}
    >
      {formattedValue}
    </span>
  );
}

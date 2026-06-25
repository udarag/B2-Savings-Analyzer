'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface AnimatedMetricValueProps {
  value: number;
  formatter?: (value: number) => string;
  durationMs?: number;
  className?: string;
}

function defaultFormatter(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

    const startValue = displayValueRef.current;
    if (Object.is(startValue, value)) {
      return;
    }

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

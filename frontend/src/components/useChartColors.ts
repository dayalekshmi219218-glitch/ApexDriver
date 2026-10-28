import { useEffect, useState } from 'react';

export interface ChartColors {
  primary: string; accent: string; text: string; muted: string; border: string;
  normal: string; watch: string; alert: string; none: string; surface: string;
}

const NAMES: Record<keyof ChartColors, string> = {
  primary: 'primary', accent: 'accent', text: 'text', muted: 'muted', border: 'border',
  normal: 'sev-normal', watch: 'sev-watch', alert: 'sev-alert', none: 'sev-none', surface: 'surface',
};

function read(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as ChartColors;
  (Object.keys(NAMES) as (keyof ChartColors)[]).forEach((k) => {
    const rgb = cs.getPropertyValue(`--${NAMES[k]}`).trim().split(/\s+/).join(',');
    out[k] = `rgb(${rgb})`;
  });
  return out;
}

export function alpha(color: string, a: number): string {
  return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
}

/** Charts need concrete colors (SVG attributes), so resolve the CSS variables and follow theme changes. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setColors(read());
    return () => obs.disconnect();
  }, []);
  return colors;
}

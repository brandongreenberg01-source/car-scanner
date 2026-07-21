// theme.js — instrument-cluster palette. Dark because you use this in a
// footwell at night, high contrast because you also use it in a driveway at
// noon, and big because you're reading it upside down under a dashboard.

export const T = {
  bg: '#0B0D0E',
  panel: '#151819',
  panelEdge: '#22272A',
  text: '#F2F4F5',
  dim: '#8C979C',
  faint: '#5A6469',

  ok: '#4ADE80',
  warn: '#FBBF24',
  bad: '#F05252',
  accent: '#7DD3FC',

  radius: 14,
  gap: 12,
};

export const F = {
  // Numerals want tabular spacing so a changing RPM doesn't shift the layout.
  mono: 'Menlo',
};

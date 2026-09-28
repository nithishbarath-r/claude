// Chart colours need real values: SVG attributes can't read CSS variables.
export const PALETTE = {
  light: {
    accent: '#5b5bd6', danger: '#e5484d', warn: '#e58a00', ok: '#2f9e6b', info: '#0b8ecf',
    grid: 'rgba(120, 132, 155, 0.18)', axis: '#8a94a6', band: 'rgba(47, 158, 107, 0.10)', surface: '#e6ebf2'
  },
  dark: {
    accent: '#8f8cff', danger: '#ff6b6f', warn: '#f5b041', ok: '#4cc38a', info: '#4fb8f0',
    grid: 'rgba(255, 255, 255, 0.06)', axis: '#7a8394', band: 'rgba(76, 195, 138, 0.10)', surface: '#252a33'
  }
}

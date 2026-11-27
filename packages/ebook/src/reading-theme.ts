export const readingThemes = {
  original: { label: 'Publisher style', scheme: '', background: '', ink: '', link: '' },
  light: { label: 'Light', scheme: 'light', background: '#fff', ink: '#252525', link: '#174889' },
  sepia: { label: 'Sepia', scheme: 'light', background: '#f4ecd8', ink: '#3d3022', link: '#70431c' },
  dark: { label: 'Dark', scheme: 'dark', background: '#181a1e', ink: '#e7e9ec', link: '#a9ceff' },
} as const;

export type ReadingTheme = keyof typeof readingThemes;

export function readingThemeCss(theme: ReadingTheme): string {
  if (theme === 'original') return '';
  const { scheme, background, ink, link } = readingThemes[theme];
  return `:root{color-scheme:${scheme}}
html,body{background-color:${background}!important;color:${ink}!important}
body :where(article,aside,blockquote,div,section,main,header,footer,nav,p,pre,code,span,h1,h2,h3,h4,h5,h6,ul,ol,li,dl,dt,dd,table,th,td,em,strong,small,figure,figcaption):not(svg *){background-color:transparent!important;color:inherit!important}
body :where(a,a *):not(svg *){color:${link}!important}`;
}

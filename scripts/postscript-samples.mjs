// Original vector artwork. SVG content is used only to author picker thumbnails.
const width = 1440, height = 960;
const orbit = `0.93 0.91 0.85 setrgbcolor 0 0 1440 960 rectfill
0.13 0.17 0.15 setrgbcolor
/Helvetica findfont 17 scalefont setfont 80 870 moveto (ORBIT / IDENTITY SYSTEM / 01) show
/Helvetica-Bold findfont 144 scalefont setfont 70 625 moveto (ORBIT) show
/Times-Italic findfont 34 scalefont setfont 80 547 moveto (Small marks. Endless possibilities.) show
/Helvetica findfont 19 scalefont setfont 80 475 moveto (An independent studio for ideas in motion.) show
gsave 1050 575 translate 22 setlinewidth
0.79 0.34 0.17 setrgbcolor newpath 0 0 172 0 360 arc stroke
0.13 0.17 0.15 setrgbcolor newpath 48 0 112 0 360 arc stroke
0.79 0.34 0.17 setrgbcolor newpath 0 0 24 0 360 arc fill grestore
0.13 0.17 0.15 setrgbcolor 1 setlinewidth 80 320 moveto 1360 320 lineto stroke
0 1 4 { /i exch def gsave 80 i 262 mul add 115 translate
0.13 0.17 0.15 setrgbcolor 0 0 210 150 rectfill
0.93 0.91 0.85 setrgbcolor newpath 105 75 44 0 360 arc fill
0.79 0.34 0.17 setrgbcolor newpath 105 75 18 0 360 arc fill grestore } for
/Helvetica findfont 13 scalefont setfont 80 60 moveto (SHAPE / RHYTHM / RECOGNITION) show`;
const edition = `0.12 0.16 0.23 setrgbcolor 0 0 1440 960 rectfill
0.94 0.85 0.70 setrgbcolor
/Helvetica findfont 17 scalefont setfont 80 870 moveto (STUDIO EDITIONS / PRINT SERIES NO. 04) show
/Helvetica-Bold findfont 125 scalefont setfont 70 665 moveto (FORM IN) show 70 530 moveto (MOTION.) show
/Times-Italic findfont 34 scalefont setfont 80 425 moveto (Printed slowly. Made to stay.) show
gsave 1110 535 translate 0.91 0.43 0.30 setrgbcolor 14 setlinewidth
0 1 7 { /i exch def newpath 0 0 38 i 29 mul add 0 360 arc stroke } for grestore
0.94 0.85 0.70 setrgbcolor 1 setlinewidth 80 255 moveto 1360 255 lineto stroke
/Helvetica findfont 17 scalefont setfont 80 180 moveto (VECTOR STUDIES / LIMITED EDITION / 2026) show
/Helvetica findfont 13 scalefont setfont 80 110 moveto (Geometry, colour and a little room for the unexpected.) show`;

export const postscriptDesigns = [
  {
    id: 'orbit-marks', format: 'eps', width, height,
    label: 'Orbit — original EPS vector brand identity',
    postscript: `%!PS-Adobe-3.0 EPSF-3.0\n%%Title: Orbit - identity system\n%%Creator: Filens contributors\n%%BoundingBox: 40 50 1480 1010\n%%HiResBoundingBox: 40 50 1480 1010\n%%EndComments\n40 50 translate\n${orbit}\n%%EOF\n`,
    content: `<rect width="1440" height="960" fill="#ede8d9"/>
<g fill="#212b26"><text x="80" y="90" font-size="17">ORBIT / IDENTITY SYSTEM / 01</text><text x="70" y="335" font-size="144" font-weight="700">ORBIT</text><text x="80" y="413" class="serif" font-size="34" font-style="italic">Small marks. Endless possibilities.</text><text x="80" y="485" font-size="19">An independent studio for ideas in motion.</text></g>
<g fill="none" stroke-width="22"><circle cx="1050" cy="385" r="172" stroke="#c9572b"/><circle cx="1098" cy="385" r="112" stroke="#212b26"/></g><circle cx="1050" cy="385" r="24" fill="#c9572b"/>
<path d="M80 640h1280" stroke="#212b26"/>
${Array.from({ length: 5 }, (_, i) => `<rect x="${80 + i * 262}" y="695" width="210" height="150" fill="#212b26"/><circle cx="${185 + i * 262}" cy="770" r="44" fill="#ede8d9"/><circle cx="${185 + i * 262}" cy="770" r="18" fill="#c9572b"/>`).join('')}
<text x="80" y="900" font-size="13" fill="#212b26">SHAPE / RHYTHM / RECOGNITION</text>`
  },
  {
    id: 'studio-editions', format: 'ps', width, height,
    label: 'Studio Editions — two-page original PostScript print study',
    postscript: `%!PS-Adobe-3.0\n%%Title: Studio Editions - vector print studies\n%%Creator: Filens contributors\n%%Pages: 2\n%%EndComments\n<< /PageSize [1440 960] >> setpagedevice\n%%Page: 1 1\n${edition}\nshowpage\n%%Page: 2 2\n0.94 0.85 0.70 setrgbcolor 0 0 1440 960 rectfill\n0.12 0.16 0.23 setrgbcolor /Helvetica-Bold findfont 92 scalefont setfont 80 765 moveto (THE COLOUR EDIT.) show\n/Times-Italic findfont 30 scalefont setfont 80 685 moveto (A palette for everyday experiments.) show\n0.12 0.16 0.23 setrgbcolor 80 220 390 350 rectfill\n0.91 0.43 0.30 setrgbcolor 525 220 390 350 rectfill\n0.31 0.47 0.39 setrgbcolor 970 220 390 350 rectfill\n0.12 0.16 0.23 setrgbcolor /Helvetica findfont 17 scalefont setfont 80 150 moveto (MIDNIGHT / TERRACOTTA / GARDEN) show\nshowpage\n%%EOF\n`,
    content: `<rect width="1440" height="960" fill="#1f293b"/>
<g fill="#f0d9b3"><text x="80" y="90" font-size="17">STUDIO EDITIONS / PRINT SERIES NO. 04</text><text x="70" y="295" font-size="125" font-weight="700">FORM IN</text><text x="70" y="430" font-size="125" font-weight="700">MOTION.</text><text x="80" y="535" class="serif" font-size="34" font-style="italic">Printed slowly. Made to stay.</text><text x="80" y="780" font-size="17">VECTOR STUDIES / LIMITED EDITION / 2026</text><text x="80" y="850" font-size="13">Geometry, colour and a little room for the unexpected.</text></g>
${Array.from({ length: 8 }, (_, i) => `<circle cx="1110" cy="425" r="${38 + i * 29}" fill="none" stroke="#e86e4d" stroke-width="14"/>`).join('')}
<path d="M80 705h1280" stroke="#f0d9b3"/>`
  }
];

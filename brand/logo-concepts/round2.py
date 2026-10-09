"""Round 2 logo concepts: light, lanterns and dawn. Marks are 64x64; ink = currentColor,
accents = var(--ac) / var(--ac2) / var(--ac3). {u} keeps ids unique per instance."""


def grad(u, name, a, b, x1=32, y1=60, x2=32, y2=8):
    return (f'<linearGradient id="{name}{u}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" style="stop-color:{a}"/><stop offset="1" style="stop-color:{b}"/></linearGradient>')


def m_lantern(u):
    # handle ring, cap, glass with a glow, flame, base
    return (f'<defs>{grad(u, "lf", "var(--ac2)", "var(--ac)", 32, 46, 32, 24)}'
            f'<radialGradient id="lg{u}" cx="32" cy="37" r="15" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" style="stop-color:var(--ac);stop-opacity:.42"/><stop offset="1" style="stop-color:var(--ac);stop-opacity:0"/></radialGradient></defs>'
            '<circle cx="32" cy="7.5" r="3.6" fill="none" stroke="currentColor" stroke-width="3"/>'
            '<path d="M21 18.5H43L39 12H25Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
            f'<rect x="18.5" y="18.5" width="27" height="31" rx="6" style="fill:url(#lg{u})"/>'
            '<rect x="18.5" y="18.5" width="27" height="31" rx="6" fill="none" stroke="currentColor" stroke-width="4"/>'
            f'<path class="flame" d="M32 25.5C35.8 30.6 38.6 33.6 38.6 38.4A6.6 6.6 0 0 1 25.4 38.4C25.4 33.6 28.2 30.6 32 25.5Z" style="fill:url(#lf{u})"/>'
            '<rect x="21" y="49.5" width="22" height="6" rx="2.5" fill="currentColor"/>')


def m_sky(u):
    # a rising paper lantern lit from inside; its seams are sound waves
    body = 'M17.5 15C17.5 6.5 46.5 6.5 46.5 15L42.5 45.5C38.5 49 25.5 49 21.5 45.5Z'
    return (f'<defs>{grad(u, "sk", "var(--ac)", "var(--ac2)", 32, 47, 32, 8)}'
            f'<radialGradient id="sg{u}" cx="32" cy="41" r="13" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" style="stop-color:#FFF6D8"/><stop offset=".45" style="stop-color:#FFF6D8;stop-opacity:.55"/>'
            f'<stop offset="1" style="stop-color:#FFF6D8;stop-opacity:0"/></radialGradient>'
            f'<clipPath id="sc{u}"><path d="{body}"/></clipPath></defs>'
            '<g class="float">'
            f'<path d="{body}" style="fill:url(#sk{u})"/>'
            f'<g clip-path="url(#sc{u})"><circle class="glow" cx="32" cy="41" r="13" style="fill:url(#sg{u})"/></g>'
            '<path d="M20 18.5C27.5 15 36.5 15 44 18.5M19.5 27C27.5 23.5 36.5 23.5 44.5 27" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round"/>'
            '</g>'
            '<path d="M32 53V55M32 59V61" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" opacity=".35"/>')


def m_daybreak(u):
    # sun breaking the horizon, two dawn bands that double as sound waves, reflection below
    return (f'<defs>{grad(u, "db", "var(--ac2)", "var(--ac)", 32, 44, 32, 28)}'
            f'<clipPath id="dc{u}"><rect x="0" y="0" width="64" height="42.5"/></clipPath></defs>'
            f'<g clip-path="url(#dc{u})">'
            '<path class="beam" style="--d:.15s;--o:.32" d="M4 44A28 28 0 0 1 60 44" fill="none" stroke="var(--ac)" stroke-width="3.6" stroke-linecap="round" opacity=".32"/>'
            '<path class="beam" style="--d:0s;--o:.62" d="M11.5 44A20.5 20.5 0 0 1 52.5 44" fill="none" stroke="var(--ac)" stroke-width="3.6" stroke-linecap="round" opacity=".62"/>'
            f'<circle class="sun" cx="32" cy="44" r="13" style="fill:url(#db{u})"/></g>'
            '<path d="M6 44H58" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>'
            '<path d="M21 51H43M26.5 57.5H37.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".35"/>')


def m_morning_l(u):
    # an L as pillar and horizon, first light rising in its corner
    return (f'<defs>{grad(u, "ml", "var(--ac2)", "var(--ac)", 37, 48, 37, 30)}'
            f'<clipPath id="mc{u}"><rect x="16" y="0" width="48" height="47"/></clipPath></defs>'
            f'<g clip-path="url(#mc{u})">'
            '<path class="beam" style="--d:0s;--o:.45" d="M18.5 52A19.5 19.5 0 0 1 57.5 52" fill="none" stroke="var(--ac)" stroke-width="3.4" stroke-linecap="round" opacity=".45"/>'
            f'<circle class="sun" cx="38" cy="52" r="12.5" style="fill:url(#ml{u})"/></g>'
            '<path d="M12 8V52H55" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>')


def m_threshold(u):
    # an open arched door with dawn inside and light spilling across the floor
    door = 'M19 52V29A13 13 0 0 1 45 29V52Z'
    return (f'<defs>{grad(u, "th", "var(--ac2)", "var(--ac3)", 32, 52, 32, 16)}'
            f'{grad(u, "ts", "var(--ac)", "var(--ac)", 32, 52, 32, 63)}'
            f'<clipPath id="tc{u}"><path d="{door}"/></clipPath></defs>'
            f'<path d="{door}" style="fill:url(#th{u})" opacity=".6"/>'
            f'<g clip-path="url(#tc{u})"><circle class="sun" cx="32" cy="52" r="12" style="fill:var(--ac)"/></g>'
            '<path class="spill" d="M19 52H45L59 62H5Z" style="fill:var(--ac)" opacity=".45"/>'
            f'<path d="{door}" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linejoin="round"/>'
            '<path d="M8 52H56" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/>')


def m_beacon(u):
    # a lighthouse lantern room whose beams are sound waves
    import math
    def arc(r, side):
        a = math.radians(34)
        cx, cy = 32, 23
        x = cx + side * r * math.cos(a)
        y1, y2 = cy - r * math.sin(a), cy + r * math.sin(a)
        sweep = 1 if side > 0 else 0
        return f'M{x:.2f} {y1:.2f}A{r} {r} 0 0 {sweep} {x:.2f} {y2:.2f}'
    beams = ''
    for i, (r, o) in enumerate([(13, .85), (20.5, .45)]):
        for side in (1, -1):
            beams += (f'<path class="beam" style="--d:{i*0.25:.2f}s;--o:{o}" d="{arc(r, side)}" fill="none" '
                      f'stroke="var(--ac)" stroke-width="3.4" stroke-linecap="round" opacity="{o}"/>')
    return (beams +
            '<path d="M25 17.5L32 10.5L39 17.5Z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>'
            '<rect class="glow" x="27" y="18.5" width="10" height="9" rx="1.5" style="fill:var(--ac)"/>'
            '<path d="M24 30.5H40" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'
            '<path d="M27.5 33H36.5L39.5 57H24.5Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
            '<path d="M18 57.5H46" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>')


DAWN = dict(app_bg='#15173A', app_ink='#FFF4E6')
ROUND2 = [
    dict(n='01', key='lantern', file='r2-01-lantern', name='Lantern', fn=m_lantern,
         ac='#FFA62B', ac2='#FF5E5B', dark_ac='#FFB547', dark_ac2='#FF7070',
         font="'Fraunces', serif", fw=500, word='Lumoras', ls='-0.02em', fontname='Fraunces Medium',
         app_ac='#FFB547', app_ac2='#FF7070', **DAWN,
         why='A lantern carried into the dark: the light you bring so a business is never unanswered. Classic and warm, with a soft serif. The flame is the brand moment and the part that moves.',
         motion='The flame flickers and the glass glows.'),
    dict(n='02', key='sky-lantern', file='r2-02-sky-lantern', name='Sky Lantern', fn=m_sky,
         ac='#FFB23F', ac2='#FF5C7A', dark_ac='#FFC061', dark_ac2='#FF7A93',
         font="'Plus Jakarta Sans', sans-serif", fw=600, word='Lumoras', ls='-0.03em', fontname='Plus Jakarta Sans SemiBold',
         app_ac='#FFC061', app_ac2='#FF7A93', **DAWN,
         why='A paper lantern released into the sky, lit from inside: a launch, a wish, something rising. Its seams curve like sound waves, so the light also carries a voice. Optimistic and friendly.',
         motion='The lantern lifts and its flame glows.'),
    dict(n='03', key='daybreak', file='r2-03-daybreak', name='Daybreak', fn=m_daybreak,
         ac='#FF9A1F', ac2='#FF4D6D', dark_ac='#FFAE45', dark_ac2='#FF6B85',
         font="'Sora', sans-serif", fw=600, word='Lumoras', ls='-0.03em', fontname='Sora SemiBold',
         app_ac='#FFAE45', app_ac2='#FF6B85', **DAWN,
         why='The sun breaking the horizon, the dawn of something great. Its two bands of first light are also the rings of sound moving out. The broadest idea of the set and the easiest to own as a symbol.',
         motion='The sun rises and the bands of light pulse.'),
    dict(n='04', key='first-light', file='r2-04-first-light', name='First Light', fn=m_morning_l,
         ac='#FFA21F', ac2='#FF5A4E', dark_ac='#FFB547', dark_ac2='#FF7464',
         font="'Geist', sans-serif", fw=600, word='Lumoras', ls='-0.035em', fontname='Geist SemiBold',
         app_ac='#FFB547', app_ac2='#FF7464', **DAWN,
         why='A monogram: the L is a pillar and a horizon, and dawn rises in its corner. Reads as the letter first and the sunrise second, which keeps it serious enough for enterprise.',
         motion='First light rises inside the L.'),
    dict(n='05', key='threshold', file='r2-05-threshold', name='Threshold', fn=m_threshold,
         ac='#FFA93A', ac2='#FF6A5C', ac3='#7B6CFF', dark_ac='#FFB95C', dark_ac2='#FF8273', dark_ac3='#9A8FFF',
         font="'Cormorant Garamond', serif", fw=600, word='Lumoras', ls='0em', fontname='Cormorant Garamond SemiBold',
         app_ac='#FFB95C', app_ac2='#FF8273', app_ac3='#9A8FFF', **DAWN,
         why='An open door onto a dawn sky, with the sun rising inside and light spilling across the floor. A new beginning for every business that walks through it. Elegant and editorial with a classical serif.',
         motion='Dawn rises in the doorway and light spills out.'),
    dict(n='06', key='beacon', file='r2-06-beacon', name='Beacon', fn=m_beacon,
         ac='#FFA62B', ac2='#FFA62B', dark_ac='#FFB547',
         font="'Bricolage Grotesque', sans-serif", fw=700, word='Lumoras', ls='-0.035em', fontname='Bricolage Grotesque Bold',
         app_ac='#FFB547', **DAWN,
         why='A lighthouse lantern room. Its beams are drawn as sound waves: a guiding light that also speaks, always on, answering every call through the night.',
         motion='The lantern glows and its beams sweep outward.'),
]

R2_META = dict(
    title='Lumoras Logo Concepts', key='lumoras-logo-shortlist-r2',
    eyebrow='Lumoras · identity · round 2 · light and dawn',
    h1='Six logo concepts built on light',
    intro='Lumoras comes from lumen, light. This round draws on lanterns, first light and the dawn of something great, and keeps a quiet nod to sound in each mark. Hover a logo to see how it moves, star the ones worth taking further, and copy your shortlist.',
    footer='Round 2 concepts. <a href="round-1.html">See round 1</a>. Wordmarks are set in Google Fonts for review; final artwork would be drawn and outlined.')

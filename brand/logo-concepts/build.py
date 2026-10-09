"""Builds the Lumoras logo-concept review page and standalone mark SVGs.

python3 build.py                -> index.html (round 2), round-1.html, svg/*.svg
python3 build.py --body OUT     -> also writes a body-only copy to OUT (for artifact publishing)
"""
import math, sys, pathlib

HERE = pathlib.Path(__file__).parent

# ---------- marks: each returns inner SVG for a 64x64 viewBox ----------
# Colors: ink = currentColor, accents = var(--ac) / var(--ac2). {u} makes ids unique per instance.

def m_equalizer(u):
    hs = [52, 12, 22, 14, 28, 10]
    out = []
    for i, h in enumerate(hs):
        x = 4 + i * 10
        fill = 'var(--ac)' if i == 4 else 'currentColor'
        out.append(f'<rect class="eq" style="--d:{i*0.09:.2f}s" x="{x}" y="{58-h}" width="7" height="{h}" rx="3.5" fill="{fill}"/>')
    return ''.join(out)

def m_resonance(u):
    cx, cy = 18, 32
    s = [f'<circle class="core" cx="{cx}" cy="{cy}" r="11" fill="var(--ac)"/>']
    for i, (r, o) in enumerate([(20, 1), (29, .62), (38, .32)]):
        a = math.radians(42)
        x = cx + r * math.cos(a); y1 = cy - r * math.sin(a); y2 = cy + r * math.sin(a)
        s.append(f'<path class="arc" style="--d:{i*0.18:.2f}s;--o:{o}" d="M{x:.2f} {y1:.2f}A{r} {r} 0 0 1 {x:.2f} {y2:.2f}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity="{o}"/>')
    return ''.join(s)

def m_conductor(u):
    d = ('M14 8V36C14 44 18 47.5 23 44.5C27.5 41.8 29 35 33.5 35C38.5 35 39 49 44 49'
         'C48.5 49 49 41.5 52.5 41.5C55.5 41.5 56.5 45 59 45')
    return f'<path class="draw" pathLength="1" d="{d}" fill="none" stroke="var(--ac)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>'

def m_overlap(u):
    return ('<g class="ovl">'
            '<circle class="l" cx="24" cy="32" r="17" fill="none" stroke="currentColor" stroke-width="5"/>'
            '<circle class="r" cx="40" cy="32" r="17" fill="none" stroke="currentColor" stroke-width="5"/>'
            '<path class="lens" d="M32 17A17 17 0 0 1 32 47A17 17 0 0 1 32 17Z" fill="var(--ac)"/></g>')

def m_speak(u):
    bars = ''.join(f'<rect class="eq" style="--d:{i*0.1:.2f}s" x="{c-2.4}" y="{29-h/2}" width="4.8" height="{h}" rx="2.4" fill="#000"/>'
                   for i, (c, h) in enumerate([(20, 8), (26, 16), (32, 23), (38, 16), (44, 8)]))
    return (f'<mask id="sp{u}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
            f'<rect width="64" height="64" fill="#fff"/>{bars}</mask>'
            f'<path mask="url(#sp{u})" d="M22 8H42A14 14 0 0 1 56 22V36A14 14 0 0 1 42 50H22L8 58V22A14 14 0 0 1 22 8Z" fill="var(--ac)"/>')

def m_pulse(u):
    def arc(a0, a1):
        r = 23; c = 32
        x0, y0 = c + r * math.cos(math.radians(a0)), c - r * math.sin(math.radians(a0))
        x1, y1 = c + r * math.cos(math.radians(a1)), c - r * math.sin(math.radians(a1))
        return f'M{x0:.2f} {y0:.2f}A{r} {r} 0 0 0 {x1:.2f} {y1:.2f}'
    return (f'<path d="{arc(24, 156)}{arc(204, 336)}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
            '<path class="run" pathLength="1" d="M4 32H17L22.5 23L28.5 43L34.5 15L40.5 40L44.5 32H60" fill="none" stroke="var(--ac)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>')

def m_score(u):
    lines = ''.join(f'<path d="M21 {y}H56" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".32"/>' for y in (12.5, 22.5, 32.5, 42.5))
    return (lines +
            '<path d="M11.5 9V52.5H56" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
            '<circle class="note" style="--d:0s" cx="31" cy="37.5" r="5.2" fill="var(--ac)"/>'
            '<circle class="note" style="--d:.2s" cx="45" cy="22.5" r="5.2" fill="var(--ac)"/>')

def m_matrix(u):
    s = []
    pos = [10, 20.5, 31, 41.5, 52]
    for ci, x in enumerate(pos):
        yc = 31 + 13 * math.sin((x - 10) / 42 * 2 * math.pi)
        for y in pos:
            r = max(1.5, min(4.7, 4.7 - 0.2 * abs(y - yc)))
            fill = 'var(--ac)' if r > 3.8 else 'currentColor'
            s.append(f'<circle class="dot" style="--d:{ci*0.12:.2f}s" cx="{x}" cy="{y}" r="{r:.2f}" fill="{fill}"/>')
    return ''.join(s)

def m_halo(u):
    return (f'<defs><linearGradient id="hg{u}" x1="8" y1="56" x2="54" y2="8" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="var(--ac2)"/><stop offset="1" stop-color="var(--ac)"/></linearGradient>'
            f'<mask id="hm{u}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/>'
            f'<circle class="eclipse" cx="37" cy="27.5" r="13" fill="#000"/></mask></defs>'
            f'<g class="spin"><path mask="url(#hm{u})" d="M32.5 6.5C47.5 6.5 58 16.5 57.5 31.5C57 47 46.5 57.5 31 57.5C16 57.5 6.5 46.5 6.5 32C6.5 17 17 6.5 32.5 6.5Z" fill="url(#hg{u})"/></g>'
            '')

def m_ring(u):
    return ('<circle class="ringo" cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="6"/>'
            '<circle class="core" cx="32" cy="32" r="9" fill="var(--ac)"/>')

CONCEPTS = [
    dict(n='01', key='equalizer', name='Equalizer L', fn=m_equalizer, ac='#0FB894', ac2='#0FB894', dark_ac='#3FE6BE',
         font="'Sora', sans-serif", fw=600, word='Lumoras', ls='-0.03em', fontname='Sora SemiBold',
         app_bg='#0B0E14', app_ink='#FFFFFF', app_ac='#3FE6BE',
         why='An L built from equalizer bars. The tall stem is the brand initial; the short bars along the base are a live level meter, so the letter itself is listening.',
         motion='Bars bounce like a level meter.'),
    dict(n='02', key='resonance', name='Resonance', fn=m_resonance, ac='#FF7A3D', ac2='#FF7A3D', dark_ac='#FF8F5A',
         font="'Geist', sans-serif", fw=600, word='Lumoras', ls='-0.035em', fontname='Geist SemiBold',
         app_bg='#FF7A3D', app_ink='#1A0E07', app_ac='#FFFFFF',
         why='A warm core sending out three waves. Lumen (light) and sound in one gesture: the business at the center, its voice carrying outward to every customer.',
         motion='Waves ripple outward in sequence.'),
    dict(n='03', key='conductor', name='Conductor', fn=m_conductor, ac='#2440FF', ac2='#2440FF', dark_ac='#7085FF',
         font="'Instrument Serif', serif", fw=400, word='Lumoras', ls='-0.01em', fontname='Instrument Serif',
         app_bg='#2440FF', app_ink='#FFFFFF', app_ac='#FFFFFF',
         why="One continuous stroke, like a conductor's baton: down the stem of an L, then out into a fading sound wave. Pairs with a serif for a premium, composed tone.",
         motion='The stroke draws itself like a baton gesture.'),
    dict(n='04', key='overlap', name='Overlap', fn=m_overlap, ac='#6A4DFF', ac2='#6A4DFF', dark_ac='#9A86FF',
         font="'Manrope', sans-serif", fw=700, word='Lumoras', ls='-0.03em', fontname='Manrope Bold',
         app_bg='#F2F0FF', app_ink='#14102B', app_ac='#6A4DFF',
         why='Two circles, voice and point of sale, meeting in a shared lens. The overlap is the product: where a call becomes a booking, an order, a sale.',
         motion='The circles drift together and the lens swells.'),
    dict(n='05', key='speak', name='Speak', fn=m_speak, ac='#0E9F8E', ac2='#0E9F8E', dark_ac='#2CD3BD',
         font="'Outfit', sans-serif", fw=600, word='Lumoras', ls='-0.02em', fontname='Outfit SemiBold',
         app_bg='#0E9F8E', app_ink='#FFFFFF', app_ac='#FFFFFF',
         why='A speech bubble with a waveform cut out of it. The most literal concept and the strongest app icon: it says "AI receptionist" at 16 pixels.',
         motion='The cut-out waveform talks.'),
    dict(n='06', key='pulse', name='Live Pulse', fn=m_pulse, ac='#F2416B', ac2='#F2416B', dark_ac='#FF6A8C',
         font="'Bricolage Grotesque', sans-serif", fw=700, word='Lumoras', ls='-0.035em', fontname='Bricolage Grotesque Bold',
         app_bg='#14080C', app_ink='#FFFFFF', app_ac='#FF6A8C',
         why='A voice signal passing through a ring. The ring is the business and the line is a live call cutting through it. Reads as always on, always answering.',
         motion='A signal runs through the ring.'),
    dict(n='07', key='score', name='Score', fn=m_score, ac='#D69A0E', ac2='#D69A0E', dark_ac='#F2BE45',
         font="'Anybody', sans-serif", fw=800, word='Lumoras', ls='-0.02em', fontname='Anybody ExtraBold, width 115', stretch='115%',
         app_bg='#0A0F1F', app_ink='#FFFFFF', app_ac='#F2BE45',
         why="A musical staff whose bracket and base line form an L, with two notes in brass. The orchestration idea at its most direct; matches the Score homepage direction.",
         motion='The notes step along the staff.'),
    dict(n='08', key='matrix', name='Signal Matrix', fn=m_matrix, ac='#0AA5D8', ac2='#0AA5D8', dark_ac='#3ED4FF',
         font="'JetBrains Mono', monospace", fw=600, word='lumoras', ls='-0.04em', fontname='JetBrains Mono SemiBold',
         app_bg='#06121A', app_ink='#9FB4C2', app_ac='#3ED4FF',
         why='A 5 by 5 dot grid with a sound wave running through it, like an LED panel. Technical and system-like, suited to an enterprise platform and a monospace wordmark.',
         motion='Dots ripple column by column.'),
    dict(n='09', key='halo', name='Halo', fn=m_halo, ac='#2EE6C5', ac2='#2F7BFF', dark_ac='#2EE6C5', dark_ac2='#4D8DFF',
         font="'Unbounded', sans-serif", fw=500, word='lumoras', ls='-0.02em', fontname='Unbounded Medium',
         app_bg='#050913', app_ink='#FFFFFF', app_ac='#2EE6C5', app_ac2='#4D8DFF',
         why='A soft, slightly irregular orb with an off-center opening: a halo of light around a voice. Heavier on one side, so it feels like it is turning toward you. The Voice Core homepage orb reduced to a mark.',
         motion='The halo turns slowly and its opening breathes.'),
    dict(n='10', key='ring', name='Ring O', fn=m_ring, ac='#FF5A36', ac2='#FF5A36', dark_ac='#FF7A5C',
         font="'Lexend', sans-serif", fw=300, word='lumoras', ls='-0.02em', fontname='Lexend Light', ring=True,
         app_bg='#FFF1EC', app_ink='#1C0F0B', app_ac='#FF5A36',
         why='A wordmark-first identity: the o in lumoras becomes a speaker ring with a glowing core. The ring alone is the icon. Quiet, confident and easy to animate.',
         motion='The ring pulses like a speaker cone.'),
]

_uid = [0]
def svg(c, size, cls='', title=None):
    _uid[0] += 1
    u = f'{c["n"]}x{_uid[0]}'
    t = f'<title>{title}</title>' if title else ''
    aria = 'role="img"' if title else 'aria-hidden="true"'
    return (f'<svg class="mk {cls}" viewBox="0 0 64 64" width="{size}" height="{size}" {aria} focusable="false">'
            f'{t}{c["fn"](u)}</svg>')

def wordmark(c, px):
    st = f'font-family:{c["font"]};font-weight:{c["fw"]};letter-spacing:{c["ls"]};font-size:{px}px'
    if c.get('stretch'):
        st += f';font-stretch:{c["stretch"]}'
    if c.get('ring'):
        ring = svg(c, round(px * .62), 'ring-o')
        return f'<span class="wm" style="{st}">lum{ring}ras</span>'
    return f'<span class="wm" style="{st}">{c["word"]}</span>'

def lockup(c, mark_px, text_px, cls=''):
    if c.get('ring'):
        return f'<div class="lock {cls}" aria-label="Lumoras" role="img">{wordmark(c, text_px)}</div>'
    return f'<div class="lock {cls}" aria-label="Lumoras" role="img">{svg(c, mark_px)}{wordmark(c, text_px)}</div>'

def card(c):
    v = (f'--ac:{c["ac"]};--ac2:{c["ac2"]};--dark-ac:{c["dark_ac"]};--dark-ac2:{c.get("dark_ac2", c["dark_ac"])};'
         f'--app-bg:{c["app_bg"]};--app-ink:{c["app_ink"]};--app-ac:{c["app_ac"]};--app-ac2:{c.get("app_ac2", c["app_ac"])};'
         f'--ac3:{c.get("ac3", c["ac2"])};--dark-ac3:{c.get("dark_ac3", c.get("dark_ac2", c["dark_ac"]))};--app-ac3:{c.get("app_ac3", c.get("app_ac2", c["app_ac"]))}')
    ladder = ''.join(f'<figure><div class="sz" style="width:{s}px;height:{s}px">{svg(c, s)}</div><figcaption>{s}</figcaption></figure>'
                     for s in (48, 32, 24, 16))
    return f'''
<article class="card" id="c{c["n"]}" data-n="{c["n"]}" style="{v}">
  <header class="card-h">
    <span class="num">{c["n"]}</span>
    <h2>{c["name"]}</h2>
    <button type="button" class="star" aria-pressed="false" data-n="{c["n"]}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/></svg>
      <span class="star-l">Shortlist</span>
    </button>
  </header>
  <div class="stage" tabindex="0" aria-label="{c["name"]} logo, hover or focus to play its motion">
    {lockup(c, 84, 54, 'big')}
    <span class="motion-note">{c["motion"]}</span>
  </div>
  <div class="tiles">
    <div class="tile dark">{lockup(c, 34, 24)}</div>
    <div class="tile app-wrap"><div class="app">{svg(c, 58)}</div><span class="cap">App icon</span></div>
  </div>
  <div class="ladder" aria-label="Mark at small sizes">{ladder}<span class="cap">px</span></div>
  <p class="why">{c["why"]}</p>
  <dl class="meta">
    <div><dt>Wordmark</dt><dd>{c["fontname"]}</dd></div>
    <div><dt>Accent</dt><dd><i class="sw" style="background:{c["ac"]}"></i>{c["ac"]}{(" → " + c["ac2"]) if c["ac2"] != c["ac"] else ""}</dd></div>
    <div><dt>File</dt><dd>svg/{c.get("file", c["n"] + "-" + c["key"])}.svg</dd></div>
  </dl>
</article>'''

FONTS = ('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500'
         '&family=Sora:wght@600&family=Instrument+Serif&family=Manrope:wght@700&family=Outfit:wght@600'
         '&family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Anybody:wdth,wght@115,800'
         '&family=JetBrains+Mono:wght@600&family=Unbounded:wght@500&family=Lexend:wght@300'
         '&family=Fraunces:opsz,wght@9..144,500&family=Cormorant+Garamond:wght@600&family=Plus+Jakarta+Sans:wght@600&display=swap')

CSS = r'''
/* Layout: a review board. Header with controls, then a two-column grid of concept cards; each card is
   one logo shown large, on dark, as an app icon and down to 16px. */
:root {
  --bg: #F4F5F7; --surface: #FFFFFF; --ink: #0D1016; --mute: #5C6372; --rule: #E0E3EA; --focus: #2440FF;
  --night: #0B0E14; --night-ink: #F1F3F7; --night-rule: #1E2430;
  --f-ui: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --f-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --ease: cubic-bezier(.2,.7,.1,1);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0A0C11; --surface: #12151C; --ink: #EEF0F5; --mute: #9AA1B0; --rule: #232835; --focus: #7085FF;
  --night: #05070B; --night-rule: #1A1F2A; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0A0C11; --surface: #12151C; --ink: #EEF0F5; --mute: #9AA1B0; --rule: #232835; --focus: #7085FF;
  --night: #05070B; --night-rule: #1A1F2A; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.6 var(--f-ui);
  padding-inline: clamp(16px, 4vw, 48px); padding-block: 40px 72px; }
.wrap { max-width: 1240px; margin: 0 auto; display: grid; gap: 32px; }
.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 20px 32px; }
.intro { display: grid; gap: 12px; max-width: 64ch; min-width: 0; }
.eyebrow { font: 500 12px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--mute); }
h1 { margin: 0; font: 600 clamp(30px, 4.6vw, 48px)/1.05 var(--f-ui); letter-spacing: -.035em; text-wrap: balance; }
.intro p { margin: 0; color: var(--mute); font-size: 16px; }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.seg { position: relative; display: inline-flex; padding: 3px; border: 1px solid var(--rule); border-radius: 99px; background: var(--surface); }
.seg button { position: relative; z-index: 1; border: 0; background: none; color: var(--mute); font: 500 13px/1 var(--f-ui);
  height: 30px; padding: 0 14px; border-radius: 99px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  transition: color .3s, background-color .3s; }
.seg button[aria-pressed="true"], .seg button[aria-checked="true"] { background: var(--ink); color: var(--bg); }
.seg button:hover:not([aria-pressed="true"]):not([aria-checked="true"]) { color: var(--ink); }
.seg .count { font-family: var(--f-mono); font-size: 12px; opacity: .8; }
.theme button { width: 34px; padding: 0; justify-content: center; }
.theme svg { width: 15px; height: 15px; }
button:focus-visible, .stage:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.toggle-motion svg { width: 14px; height: 14px; }

.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.card { background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; padding: 18px; display: grid; gap: 14px;
  align-content: start; min-width: 0; transition: border-color .3s; }
.card.is-star { border-color: color-mix(in srgb, var(--ac) 70%, var(--rule)); }
.card-h { display: flex; align-items: center; gap: 12px; }
.num { font: 500 12px/1 var(--f-mono); color: var(--mute); letter-spacing: .06em; }
.card h2 { margin: 0; font: 600 18px/1.2 var(--f-ui); letter-spacing: -.02em; flex: 1; min-width: 0; }
.star { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px; border-radius: 99px;
  border: 1px solid var(--rule); background: none; color: var(--mute); font: 500 13px/1 var(--f-ui); cursor: pointer;
  transition: color .25s, border-color .25s, background-color .25s; }
.star svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; transition: transform .4s var(--ease); }
.star:hover { color: var(--ink); border-color: var(--mute); }
.star[aria-pressed="true"] { color: var(--ink); border-color: var(--ac); background: color-mix(in srgb, var(--ac) 12%, transparent); }
.star[aria-pressed="true"] svg { fill: var(--ac); stroke: var(--ac); transform: rotate(72deg) scale(1.08); }

.stage { position: relative; display: grid; place-items: center; min-height: 230px; border-radius: 12px; padding: 28px 16px 40px;
  background: color-mix(in srgb, var(--bg) 60%, var(--surface)); border: 1px solid var(--rule); overflow: hidden; color: var(--ink); }
.motion-note { position: absolute; left: 14px; bottom: 11px; font: 400 11px/1.3 var(--f-mono); color: var(--mute); letter-spacing: .02em;
  opacity: 0; transform: translateY(4px); transition: opacity .3s, transform .3s var(--ease); }
.stage:hover .motion-note, .stage:focus-visible .motion-note, body.play .motion-note { opacity: 1; transform: none; }
.lock { display: inline-flex; align-items: center; gap: .36em; max-width: 100%; color: inherit; }
.lock.big { gap: 20px; flex-wrap: wrap; justify-content: center; }
.wm { line-height: 1; white-space: nowrap; display: inline-flex; align-items: center; }
.wm .ring-o { margin: 0 .04em; transform: translateY(.06em); }
.mk { flex: none; display: block; overflow: visible; }
.tiles { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.tile { border-radius: 12px; display: grid; place-items: center; min-height: 112px; padding: 16px; min-width: 0; overflow: hidden; }
.tile.dark { background: var(--night); color: var(--night-ink); border: 1px solid var(--night-rule); --ac: var(--dark-ac); --ac2: var(--dark-ac2); --ac3: var(--dark-ac3); }
.app-wrap { background: color-mix(in srgb, var(--bg) 60%, var(--surface)); border: 1px solid var(--rule); gap: 8px; padding: 12px 18px; }
.app { width: 88px; height: 88px; border-radius: 22px; display: grid; place-items: center; background: var(--app-bg); color: var(--app-ink);
  --ac: var(--app-ac); --ac2: var(--app-ac2); --ac3: var(--app-ac3); box-shadow: 0 0 0 1px var(--rule), 0 1px 0 rgba(255,255,255,.08) inset, 0 6px 18px -8px rgba(10,15,30,.35); }
.cap { font: 400 11px/1 var(--f-mono); color: var(--mute); }
.ladder { display: flex; align-items: flex-end; gap: 22px; padding: 4px 2px 0; flex-wrap: wrap; color: var(--ink); }
.ladder figure { margin: 0; display: grid; justify-items: center; gap: 6px; }
.ladder figcaption { font: 400 11px/1 var(--f-mono); color: var(--mute); }
.ladder .cap { align-self: flex-end; margin-left: -12px; }
.why { margin: 0; color: var(--ink); max-width: 62ch; }
.meta { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 22px; border-top: 1px solid var(--rule); padding-top: 12px; }
.meta div { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.meta dt { font: 400 11px/1.4 var(--f-mono); color: var(--mute); text-transform: uppercase; letter-spacing: .08em; }
.meta dd { margin: 0; font: 400 13px/1.4 var(--f-mono); display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.empty { grid-column: 1 / -1; border: 1px dashed var(--rule); border-radius: 16px; padding: 40px 20px; text-align: center; color: var(--mute); }
.dock { position: sticky; bottom: max(16px, env(safe-area-inset-bottom, 0px)); justify-self: center; display: flex; flex-wrap: wrap; align-items: center;
  gap: 10px 14px; padding: 10px 10px 10px 18px; background: var(--ink); color: var(--bg); border-radius: 99px;
  box-shadow: 0 12px 30px -12px rgba(0,0,0,.45); max-width: 100%; }
.dock[hidden] { display: none !important; }
.dock .lbl { font: 500 13px/1.3 var(--f-ui); }
.dock .ids { font: 500 13px/1 var(--f-mono); }
.dock button { height: 32px; padding: 0 14px; border-radius: 99px; border: 0; background: var(--bg); color: var(--ink); font: 500 13px/1 var(--f-ui); cursor: pointer; }
.dock button:focus-visible { outline-color: var(--bg); }
footer { color: var(--mute); font-size: 13px; border-top: 1px solid var(--rule); padding-top: 18px; display: grid; gap: 4px; }
footer code { font-family: var(--f-mono); font-size: 12px; }
footer a { color: inherit; text-underline-offset: 3px; }
@media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 520px) {
  .lock.big { gap: 14px; }
  .lock.big .mk { width: 60px; height: 60px; }
  .lock.big .wm { font-size: 38px !important; }
  .tiles { grid-template-columns: minmax(0, 1fr); }
  .tile.dark .wm { font-size: 20px !important; }
  .stage { min-height: 190px; }
  .seg button { padding: 0 11px; }
}

/* ---------- motion (plays on stage hover/focus, or everywhere with "Play motion") ---------- */
.mk * { transform-box: fill-box; }
.eq { transform-origin: 50% 100%; }
.arc, .note, .dot, .core, .ringo, .eclipse { transform-origin: 50% 50%; }
.spin { transform-origin: 50% 50%; transform-box: view-box; }
.ovl .l, .ovl .r, .ovl .lens { transform-origin: 50% 50%; }
.draw, .run { stroke-dasharray: 1; stroke-dashoffset: 0; }
@keyframes eq { 0%,100% { transform: scaleY(1); } 35% { transform: scaleY(.45); } 65% { transform: scaleY(1.18); } }
@keyframes arc { 0%,100% { opacity: var(--o); } 40% { opacity: .08; } 70% { opacity: 1; } }
@keyframes core { 0%,100% { transform: scale(1); } 50% { transform: scale(.82); } }
@keyframes draw { 0% { stroke-dashoffset: 1; } 55%,100% { stroke-dashoffset: 0; } }
@keyframes run { 0% { stroke-dasharray: .18 1; stroke-dashoffset: .18; } 100% { stroke-dasharray: .18 1; stroke-dashoffset: -1; } }
@keyframes ovl-l { 0%,100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
@keyframes ovl-r { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-3px); } }
@keyframes lens { 0%,100% { transform: scale(1); } 50% { transform: scale(1.22, 1.08); } }
@keyframes note { 0%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } 60% { transform: translateY(2px); } }
@keyframes dot { 0%,100% { transform: scale(1); } 40% { transform: scale(.4); } 70% { transform: scale(1.25); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes eclipse { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-3px,3px) scale(.86); } }
@keyframes ringo { 0%,100% { transform: scale(1); } 20% { transform: scale(.9); } 45% { transform: scale(1.06); } }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .eq { animation: eq 1.1s var(--d) ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .arc { animation: arc 1.6s var(--d) ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .core { animation: core 1.6s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .draw { animation: draw 2.4s var(--ease) infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .run { animation: run 1.8s linear infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .ovl .l { animation: ovl-l 2.2s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .ovl .r { animation: ovl-r 2.2s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .lens { animation: lens 2.2s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .note { animation: note 1.4s var(--d) var(--ease) infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .dot { animation: dot 1.5s var(--d) ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .spin { animation: spin 14s linear infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .eclipse { animation: eclipse 3s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .ringo { animation: ringo 1.3s ease-in-out infinite; }
.flame, .float, .sun, .spill, .beam, .glow { transform-origin: 50% 100%; }
.glow { transform-origin: 50% 50%; }
@keyframes flame { 0%,100% { transform: scale(1,1) skewX(0); } 25% { transform: scale(.94,1.08) skewX(-3deg); } 50% { transform: scale(1.04,.95) skewX(2deg); } 75% { transform: scale(.97,1.05) skewX(-1deg); } }
@keyframes glow { 0%,100% { opacity: .9; transform: scale(1); } 50% { opacity: .55; transform: scale(.9); } }
@keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes sun { 0% { transform: translateY(9px); } 55%,100% { transform: translateY(0); } }
@keyframes spill { 0% { opacity: .05; } 55%,100% { opacity: 1; } }
@keyframes beam { 0%,100% { opacity: var(--o); } 50% { opacity: .08; } }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .flame { animation: flame 1.3s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .glow { animation: glow 1.3s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .float { animation: float 3s ease-in-out infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .sun { animation: sun 3.2s var(--ease) infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .spill { animation: spill 3.2s var(--ease) infinite; }
:is(.stage:hover, .stage:focus-visible, body.play .stage) .beam { animation: beam 1.6s var(--d) ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .stage * { animation: none !important; } .star svg { transition: none; } }
'''

JS = r'''
(() => {
  const root = document.documentElement;
  /* theme: Light / Dark / Auto, shared with the homepage prototypes via localStorage "lumoras-theme" */
  const group = document.getElementById('theme');
  const tbtns = [...group.querySelectorAll('button')];
  let mode = 'auto';
  try { const t = localStorage.getItem('lumoras-theme'); if (t === 'light' || t === 'dark' || t === 'auto') mode = t; } catch (e) {}
  const paintTheme = () => tbtns.forEach(b => { const on = b.dataset.mode === mode; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  const setTheme = (m) => {
    mode = m;
    if (m === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    try { localStorage.setItem('lumoras-theme', m); } catch (e) {}
    paintTheme();
  };
  tbtns.forEach((b, i) => {
    b.addEventListener('click', () => setTheme(b.dataset.mode));
    b.addEventListener('keydown', e => {
      const d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
      if (!d) return; e.preventDefault();
      const n = tbtns[(i + d + tbtns.length) % tbtns.length]; n.focus(); setTheme(n.dataset.mode);
    });
  });
  paintTheme();

  /* shortlist, remembered in this browser */
  const KEY = document.body.dataset.key || 'lumoras-logo-shortlist';
  let picks = [];
  try { picks = JSON.parse(localStorage.getItem(KEY) || '[]').filter(x => /^\d\d$/.test(x)); } catch (e) {}
  const cards = [...document.querySelectorAll('.card')];
  const names = Object.fromEntries(cards.map(c => [c.dataset.n, c.querySelector('h2').textContent]));
  const dock = document.getElementById('dock'), ids = document.getElementById('dock-ids'), cnt = document.getElementById('count');
  const empty = document.getElementById('empty');
  let filter = 'all';
  const summary = () => picks.slice().sort().map(n => n + ' ' + names[n]).join(', ');
  const render = () => {
    cards.forEach(c => {
      const on = picks.includes(c.dataset.n);
      c.classList.toggle('is-star', on);
      c.querySelector('.star').setAttribute('aria-pressed', on);
      c.querySelector('.star-l').textContent = on ? 'Shortlisted' : 'Shortlist';
      c.hidden = filter === 'short' && !on;
    });
    cnt.textContent = picks.length;
    empty.hidden = !(filter === 'short' && picks.length === 0);
    dock.hidden = picks.length === 0;
    ids.textContent = summary();
    try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) {}
  };
  document.querySelectorAll('.star').forEach(b => b.addEventListener('click', () => {
    const n = b.dataset.n;
    picks = picks.includes(n) ? picks.filter(x => x !== n) : [...picks, n];
    render();
  }));
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  }));
  const playBtn = document.getElementById('play');
  playBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('play');
    playBtn.setAttribute('aria-pressed', on);
    playBtn.querySelector('.pl').textContent = on ? 'Pause motion' : 'Play motion';
  });
  const copyBtn = document.getElementById('copy');
  copyBtn.addEventListener('click', () => {
    const text = 'Lumoras logo shortlist: ' + summary();
    const done = (msg) => { copyBtn.textContent = msg; setTimeout(() => copyBtn.textContent = 'Copy shortlist', 1800); };
    const fallback = () => {
      const r = document.createRange(); r.selectNodeContents(ids);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); done('Selected, press Copy');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done('Copied'), fallback);
    else fallback();
  });
  render();
})();
'''

THEME_CTRL = '''<div class="seg theme" role="radiogroup" aria-label="Color theme" id="theme">
  <button type="button" role="radio" aria-checked="false" data-mode="light" title="Light"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg><span class="sr">Light</span></button>
  <button type="button" role="radio" aria-checked="false" data-mode="dark" title="Dark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg><span class="sr">Dark</span></button>
  <button type="button" role="radio" aria-checked="true" data-mode="auto" title="Auto (follows your device)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/></svg><span class="sr">Auto</span></button>
</div>'''

def page(full, concepts, meta):
    head = f'''<title>{meta['title']}</title>
<script>try {{ var t = localStorage.getItem('lumoras-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); }} catch (e) {{}}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>{CSS}</style>'''
    body = f'''<main class="wrap">
  <div class="top">
    <div class="intro">
      <span class="eyebrow">{meta['eyebrow']}</span>
      <h1>{meta['h1']}</h1>
      <p>{meta['intro']}</p>
    </div>
    <div class="controls">
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-filter="all" aria-pressed="true">All <span class="count">{len(concepts)}</span></button>
        <button type="button" data-filter="short" aria-pressed="false">Shortlist <span class="count" id="count">0</span></button>
      </div>
      <div class="seg"><button type="button" id="play" class="toggle-motion" aria-pressed="false"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg><span class="pl">Play motion</span></button></div>
      {THEME_CTRL}
    </div>
  </div>
  <section class="grid" aria-label="Logo concepts">
    {''.join(card(c) for c in concepts)}
    <p class="empty" id="empty" hidden>No logos on your shortlist yet. Use the Shortlist button on any concept to add it.</p>
  </section>
  <div class="dock" id="dock" hidden>
    <span class="lbl">Shortlist:</span><span class="ids" id="dock-ids"></span>
    <button type="button" id="copy">Copy shortlist</button>
  </div>
  <footer>
    <span>{meta['footer']}</span>
    <span>Source: <code>brand/logo-concepts/</code> · mark files in <code>svg/</code> · regenerate with <code>python3 build.py</code></span>
  </footer>
</main>
<script>{JS}</script>'''
    if full:
        return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{head}
</head>
<body data-key="{meta['key']}">
{body}
</body>
</html>
'''
    return head + '\n' + f'<script>document.body.dataset.key = "{meta["key"]}";</script>' + '\n' + body + '\n'

def standalone(c):
    inner = (c['fn']('s').replace('currentColor', '#0D1016').replace('var(--ac2)', c['ac2']).replace('var(--ac)', c['ac'])
             .replace('var(--ac3)', c.get('ac3', c['ac2'])))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256"><title>Lumoras · {c["name"]}</title>{inner}</svg>\n'

R1_META = dict(
    title='Lumoras Logo Concepts, Round 1', key='lumoras-logo-shortlist',
    eyebrow='Lumoras · identity · round 1',
    h1='Ten logo concepts for Lumoras',
    intro='Each concept is a mark and a wordmark, shown large, on dark, as an app icon and down to 16 pixels, the size of a browser tab icon. Hover a logo to see how it moves. Star the ones worth taking further and copy your shortlist.',
    footer='Round 1 concepts (set aside). <a href="index.html">See round 2</a>. Wordmarks are set in Google Fonts for review; final artwork would be drawn and outlined.')

from round2 import ROUND2, R2_META  # noqa: E402

if __name__ == '__main__':
    (HERE / 'round-1.html').write_text(page(True, CONCEPTS, R1_META))
    (HERE / 'index.html').write_text(page(True, ROUND2, R2_META))
    (HERE / 'svg').mkdir(exist_ok=True)
    for c in CONCEPTS + ROUND2:
        (HERE / 'svg' / f'{c.get("file", c["n"] + "-" + c["key"])}.svg').write_text(standalone(c))
    if len(sys.argv) == 3 and sys.argv[1] == '--body':
        pathlib.Path(sys.argv[2]).write_text(page(False, ROUND2, R2_META))
    print('built', len(CONCEPTS), '+', len(ROUND2), 'concepts')

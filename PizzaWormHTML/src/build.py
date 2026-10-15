"""Builds ../index.html from the sources in this folder and the original game data.

Usage:  python build.py
Reads the original DOS files from ../../pworm21g.zip (or from an unpacked
../../pworm21g/pworm21g/ folder if present) and embeds them (base64) so the
result is a single self-contained HTML file.
"""
import base64, json, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
SRC = os.path.join(ROOT, 'pworm21g', 'pworm21g')
ZIP = os.path.join(ROOT, 'pworm21g.zip')
OUT = os.path.join(HERE, '..', 'index.html')

def rd(name):
    if os.path.isdir(SRC):
        with open(os.path.join(SRC, name), 'rb') as f:
            return f.read()
    with zipfile.ZipFile(ZIP) as z:
        return z.read('pworm21g/' + name)

# The 5x5 font lives in the EXE's initialised data segment (DS = 1392h,
# glyphs at DS:0021h, 25 bytes each, 51 glyphs). MZ header is 18Ah paragraphs.
exe = rd('PWORM.EXE')
ds = 0x13920 + 0x18a * 16
font = bytearray()
for i in range(1, 52):
    for r in range(1, 6):
        for c in range(1, 6):
            font.append(1 if exe[ds + 0x21 + i * 25 + r * 5 + c] else 0)

b64 = lambda b: base64.b64encode(b).decode()
assets = {
    'font': b64(bytes(font)),
    'title': b64(rd('PWORM.004')),   # title picture (PCX)
    'hisc': b64(rd('PWORM.002')),    # highscore picture (PCX)
    'play': b64(rd('PWORM.003')),    # pizza parlor play field (PCX)
    'mod': b64(rd('PWORM.001')),     # Izzard's M.K. module + voice samples
}

def src(name):
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()

page = src('page.html')
page = page.replace('/*ASSETS*/', 'const ASSETS = ' + json.dumps(assets) + ';')
page = page.replace('/*MODPLAYER*/', src('modplayer.js'))
page = page.replace('/*GAME*/', src('game.js'))

head_end = page.index('</style>') + len('</style>')
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + page[:head_end] + '\n</head>\n<body>\n' + page[head_end:] + '\n</body>\n</html>\n')
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(full)
print('wrote', OUT, len(full), 'bytes')

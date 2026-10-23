#!/usr/bin/env python3
"""PIXEL QUIZ ARENA - Musiques de fond enregistrées (boucles de l'émission).

    python3 scripts/import_music.py      (ffmpeg requis, accès à incompetech.com)

De vrais morceaux joués par des musiciens, de Kevin MacLeod (incompetech.com),
sous licence Creative Commons Attribution 4.0 : gratuits, à condition de les
créditer (fait dans le panneau Sons et dans audio/music/CREDITS.txt).
Chaque morceau est téléchargé, nettoyé (silences, fondu de fin pour que la
boucle reparte en douceur), mis au même volume et compressé en Opus dans
audio/music/. Les jingles courts restent composés par scripts/compose_music.py.
"""
import json
import os
import subprocess
import tempfile
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'audio', 'music')
CACHE = os.environ.get('PQA_MUSIC_CACHE', os.path.join(tempfile.gettempdir(), 'pqa-music'))
BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/'

# boucle du jeu -> (titre, vitesse, volume LUFS). Voir BEDS dans js/music.js pour les manches.
TRACKS = {
    'theme': ('Rollin at 5', 1.0, -17),           # accueil
    'bed1': ('Spy Glass', 1.0, -19),            # Thème mystère, Cases mystères
    'bed2': ('Funky Chunk', 1.0, -19),          # 4 à la suite, Fourchette
    'bed3': ('Rollin at 5', 1.12, -19),            # Sprint, QCM éclair, duels
    'suspense': ('Thinking Music', 1.0, -20),   # pendant les questions
    'leaderboard': ('Hot Swing', 1.0, -18),     # classement
    'finale': ('Disco con Tutti', 1.0, -17),    # fin de partie
}


def source(title):
    path = os.path.join(CACHE, title.replace(' ', '_') + '.mp3')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        req = urllib.request.Request(BASE + urllib.parse.quote(title) + '.mp3', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                          '-of', 'csv=p=0', path]))


def main():
    manifest_path = os.path.join(OUT, 'manifest.json')
    with open(manifest_path, encoding='utf-8') as f:
        manifest = json.load(f)
    # Les jingles (compose_music.py) restent ; les boucles sont remplacées.
    cues = {c for c in manifest.get('cues', []) if c not in manifest.get('loops', {}) and not c.startswith('suspense')}
    loops = {}
    credits = []
    for name, (title, speed, lufs) in TRACKS.items():
        src = source(title)
        dest = os.path.join(OUT, name + '.webm')
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'a.wav')
            # Silences coupés, vitesse éventuelle, volume commun.
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af',
                            'silenceremove=start_periods=1:start_threshold=-55dB,areverse,'
                            'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
                            f'atempo={speed},loudnorm=I={lufs}:TP=-1.5:LRA=9', '-ar', '48000', wav], check=True)
            d = duration(wav)
            # Fondu de fin : la boucle repart sans claquement.
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af',
                            f'afade=t=in:d=0.05,afade=t=out:st={d - 2.5:.3f}:d=2.5',
                            '-c:a', 'libopus', '-b:a', '96k', dest], check=True)
        loops[name] = round(d, 4)
        cues.add(name)
        credits.append(f'{name:12s} « {title} »')
        print(f'{name:12s} {title} ({d:.0f} s, {os.path.getsize(dest) // 1024} Ko)', flush=True)
    for old in ('suspense1', 'suspense2'):
        p = os.path.join(OUT, old + '.webm')
        if os.path.exists(p):
            os.remove(p)
    manifest.update(loops=loops, cues=sorted(cues))
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('Musiques de fond : Kevin MacLeod (incompetech.com)\n'
                'Licence Creative Commons Attribution 4.0 : http://creativecommons.org/licenses/by/4.0/\n\n'
                + '\n'.join(credits) + '\n\n'
                'Jingles : compositions originales (scripts/compose_music.py), banque FluidR3_GM (MIT).\n')


if __name__ == '__main__':
    main()

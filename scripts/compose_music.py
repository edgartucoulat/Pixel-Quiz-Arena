#!/usr/bin/env python3
"""PIXEL QUIZ ARENA - Compose et enregistre les jingles de l'émission.

    pip install mido      (et fluidsynth + ffmpeg installés)
    python3 scripts/compose_music.py [chemin/vers/banque.sf2]

Toutes les musiques sont composées ici (aucune reprise), puis jouées par de
vrais instruments échantillonnés : la banque de sons libre FluidR3_GM
(licence MIT, paquet Debian/Ubuntu « fluid-soundfont-gm »). Le résultat est
écrit dans audio/music/ en Opus : les jingles joués une fois (ouverture,
annonce de chaque manche, victoire). Les musiques de fond sont de vrais
morceaux enregistrés : voir scripts/import_music.py.
"""
import json
import os
import random
import subprocess
import sys
import tempfile

import mido

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'audio', 'music')
SF2 = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/sounds/sf2/FluidR3_GM.sf2'
RATE = 48000

NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def N(name):
    """'C4' -> 60, 'F#3' -> 54, 'Bb2' -> 46."""
    p = NAMES[name[0]]
    i = 1
    while i < len(name) and name[i] in '#b':
        p += 1 if name[i] == '#' else -1
        i += 1
    return p + 12 * (int(name[i:]) + 1)


QUAL = {'': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
        'sus4': [0, 5, 7], 'dim': [0, 3, 6], 'add9': [0, 4, 7, 14], 'm9': [0, 3, 7, 10, 14]}


def chord(sym, octave=3):
    """'Am7' -> notes à partir de la fondamentale à l'octave donnée."""
    root = sym[0] + (sym[1] if len(sym) > 1 and sym[1] in '#b' else '')
    q = sym[len(root):]
    base = N(root + str(octave))
    return [base + i for i in QUAL[q]]


# Instruments General MIDI
PIANO, BPIANO, EPIANO, CLAV, CELESTA, VIBES, ORGAN = 0, 1, 4, 7, 8, 11, 16
ABASS, FBASS, SLAPBASS, SYNBASS = 32, 33, 36, 38
STRINGS, SLOWSTR, SYNSTR, PIZZ, HARP, TIMP, TREM = 48, 49, 50, 45, 46, 47, 44
CHOIR, TRUMPET, TROMBONE, HORN, BRASS, FLUTE, PAD = 52, 56, 57, 60, 61, 73, 89
SQLEAD, SAWLEAD = 80, 81
DR = 9  # canal batterie
KICK, SIDE, SNARE, CLAP, HAT, PHAT, OHAT, CRASH, RIDE, TAMB = 36, 37, 38, 39, 42, 44, 46, 49, 51, 54
LTOM, MTOM, HTOM, WOOD, SHAKER, TRI = 45, 47, 50, 76, 70, 81


class Song:
    def __init__(self, bpm, beats=None):
        self.bpm = bpm
        self.beats = beats  # longueur de boucle (en temps) ; None = jingle
        self.ev = []
        self.rng = random.Random(bpm * 1000 + (beats or 0))  # même partition à chaque fois
        self.progs = {}
        self.vols = {}

    def inst(self, ch, program, vol=100):
        self.progs[ch] = program
        self.vols[ch] = vol

    def n(self, ch, t, pitch, dur, vel=80):
        # Un vrai musicien n'est jamais pile sur la grille : un poil de décalage
        # et de nuance rend le tout vivant au lieu de mécanique.
        r = self.rng
        t = max(0, t + r.uniform(-0.012, 0.012))
        self.ev.append((t, ch, pitch, dur, vel + r.randint(-7, 7)))

    def ch(self, ch, t, pitches, dur, vel=70):
        for p in pitches:
            self.n(ch, t, p, dur, vel)

    def seq(self, ch, t, notes, step, vel=80, legato=0.9):
        """notes : noms ('C5'), nombres MIDI ou None (silence)."""
        for i, x in enumerate(notes):
            if x is None:
                continue
            self.n(ch, t + i * step, N(x) if isinstance(x, str) else x, step * legato, vel)

    def midi(self, path, repeat=1):
        tpb = 480
        mf = mido.MidiFile(ticks_per_beat=tpb)
        tr = mido.MidiTrack()
        mf.tracks.append(tr)
        msgs = [(0, mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(self.bpm)))]
        for c, p in self.progs.items():
            msgs.append((0, mido.Message('program_change', channel=c, program=p)))
            msgs.append((0, mido.Message('control_change', channel=c, control=7, value=self.vols[c])))
            msgs.append((0, mido.Message('control_change', channel=c, control=91, value=32)))  # réverbération (sèche = plus punchy)
        span = self.beats or 0
        for r in range(repeat):
            for t, c, p, d, v in self.ev:
                t0 = t + r * span
                msgs.append((int(t0 * tpb), mido.Message('note_on', channel=c, note=p, velocity=max(1, min(127, int(v))))))
                msgs.append((int((t0 + d) * tpb) - 1, mido.Message('note_off', channel=c, note=p, velocity=0)))
        msgs.sort(key=lambda m: (m[0], m[1].type == 'note_on'))
        now = 0
        for at, m in msgs:
            tr.append(m.copy(time=max(0, at - now)))
            now = max(now, at)
        tr.append(mido.MetaMessage('end_of_track', time=int(4 * tpb)))
        mf.save(path)

    def seconds(self, beats):
        return beats * 60.0 / self.bpm


def render(song, name, loudness):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        mid, wav = os.path.join(tmp, 'a.mid'), os.path.join(tmp, 'a.wav')
        loop = song.beats is not None
        # Boucle : on joue 2 tours et on garde le second, qui contient déjà la
        # queue de réverbération du premier : la boucle est sans couture.
        song.midi(mid, repeat=2 if loop else 1)
        subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.6', '-r', str(RATE), '-F', wav, SF2, mid],
                       check=True, capture_output=True)
        dest = os.path.join(OUT, name + '.webm')
        # Mastering façon émission de télé : compresseur (ça colle et ça pousse),
        # un peu plus de grave et de brillance.
        master = 'acompressor=threshold=-20dB:ratio=3.5:attack=8:release=140:makeup=3,bass=g=3:f=90,treble=g=3:f=7000'
        if loop:
            L = song.seconds(song.beats)
            af = f'{master},atrim=start={L:.4f}:end={2 * L:.4f},asetpts=PTS-STARTPTS,loudnorm=I={loudness}:TP=-1.5:LRA=8'
        else:
            af = (f'silenceremove=start_periods=1:start_threshold=-60dB,areverse,'
                  f'silenceremove=start_periods=1:start_threshold=-55dB,afade=t=in:d=0.4,areverse,'
                  f'{master},loudnorm=I={loudness}:TP=-1:LRA=8')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', af, '-ar', str(RATE),
                        '-c:a', 'libopus', '-b:a', '64k', dest], check=True)
    return dest


# ======================================================================
# Jingles (joués une fois)
# ======================================================================

def fanfare(bpm, mel, chords, extra=None, crash=True):
    s = Song(bpm)
    s.inst(0, TRUMPET, 110); s.inst(1, BRASS, 95); s.inst(2, STRINGS, 90); s.inst(3, TIMP, 110); s.inst(4, HORN, 90); s.inst(DR, 0, 100)
    t = 0
    for p, d in mel:
        if p:
            s.n(0, t, N(p), d * 0.92, 105)
            s.n(4, t, N(p) - 12, d * 0.92, 80)
        t += d
    for at, c, d in chords:
        s.ch(1, at, chord(c, 3), d, 85)
        s.ch(2, at, chord(c, 4) + [chord(c, 2)[0]], d, 80)
        s.n(3, at, chord(c, 2)[0], 0.8, 110)
    if crash:
        s.n(DR, chords[-1][0], CRASH, 3, 110)
        s.n(DR, chords[-1][0], KICK, 0.5, 110)
    if extra:
        extra(s)
    return s


def roll(s, t, beats, vel=60):
    """Roulement de caisse claire qui monte."""
    n = int(beats * 6)
    for i in range(n):
        s.n(DR, t + i / 6, SNARE, 0.1, vel + (127 - vel) * i / n)


def opening():
    def extra(s):
        roll(s, 0, 2, 40)
        for i in range(8):
            s.n(3, i * 0.25, N('C2'), 0.2, 60 + i * 8)
    mel = [(None, 2), ('G4', 0.5), ('G4', 0.25), ('G4', 0.25), ('C5', 1), ('E5', 0.75), ('D5', 0.25), ('C5', 0.5), ('E5', 0.5),
           ('G5', 1.5), ('E5', 0.5), ('F5', 0.5), ('A5', 0.5), ('G5', 0.5), ('E5', 0.5), ('C6', 3)]
    return fanfare(116, mel, [(2, 'C', 1), (3, 'C', 2), (5, 'G', 1), (6, 'F', 1.5), (7.5, 'G', 1.5), (9, 'C', 3)], extra)


def victory():
    def extra(s):
        roll(s, 0, 1.5, 50)
        s.inst(5, CHOIR, 90)
        s.ch(5, 7.5, chord('C', 4), 3.5, 80)
    mel = [(None, 1.5), ('C5', 0.33), ('C5', 0.33), ('C5', 0.34), ('C5', 1), ('Ab4', 1), ('Bb4', 1), ('C5', 0.66), ('Bb4', 0.34), ('C5', 3)]
    return fanfare(110, mel, [(1.5, 'C', 1), (2.5, 'Ab', 1), (3.5, 'Bb', 1), (4.5, 'C', 1), (5.5, 'Bb', 1), (6.5, 'C', 1), (7.5, 'C', 3.5)], extra)


def transition():
    """Petit habillage (classement, face-à-face) : montée de cordes + accord."""
    s = Song(120)
    s.inst(0, STRINGS, 100); s.inst(1, BRASS, 90); s.inst(DR, 0, 90)
    s.seq(0, 0, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 0.125, 80)
    s.ch(1, 1, chord('Cadd9', 4), 2, 95)
    s.ch(0, 1, chord('C', 4) + [N('C3')], 2.5, 85)
    s.n(DR, 1, CRASH, 2, 90)
    return s


def round_jingle(kind):
    """Annonce de manche : un motif propre à chaque manche."""
    s = Song(120)
    if kind == 'sprint':  # course : cuivres qui galopent, caisse claire
        s.bpm = 150
        s.inst(0, TRUMPET, 110); s.inst(1, BRASS, 95); s.inst(2, STRINGS, 85); s.inst(DR, 0, 100)
        s.seq(0, 0, ['C5', 'C5', 'G4', 'C5', 'E5', 'E5', 'C5', 'E5', 'G5', None, 'G5', 'A5', 'C6'], 0.25, 105)
        s.seq(2, 0, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'], 0.25, 70)
        for i in range(12):
            s.n(DR, i * 0.25, SNARE, 0.1, 60 + i * 4)
        s.ch(1, 3, chord('C', 3) + [N('C2')], 2, 110); s.n(DR, 3, CRASH, 2, 110); s.n(DR, 3, KICK, 0.3, 110)
    elif kind == 'mystere':  # roue du destin : harpe, célesta, nappe
        s.bpm = 96
        s.inst(0, HARP, 100); s.inst(1, CELESTA, 90); s.inst(2, SLOWSTR, 75); s.inst(DR, 0, 80)
        s.seq(0, 0, ['A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6'], 0.125, 80)
        s.seq(1, 1, ['E6', 'C6', 'A5', 'B5', 'G#5'], 0.33, 75, 1.4)
        s.ch(2, 1, chord('Am', 3) + [N('F#4')], 3, 70)
        s.n(DR, 1, 52, 3, 60)  # cymbale chinoise
    elif kind == 'eclair':  # éclair : cordes staccato rapides
        s.bpm = 160
        s.inst(0, STRINGS, 100); s.inst(1, BRASS, 100); s.inst(DR, 0, 100)
        for i, c in enumerate(['G', 'A', 'B', 'C']):
            s.ch(0, i * 0.5, chord(c, 4), 0.2, 80 + i * 10)
            s.n(DR, i * 0.5, KICK, 0.2, 90)
        s.ch(1, 2, chord('C', 4) + [N('C3')], 1.5, 110); s.n(DR, 2, CRASH, 2, 110)
        s.seq(0, 2, ['C6', 'G5', 'E5', 'C5'], 0.125, 90)
    elif kind == 'table':  # cases mystères : vibraphone et pizz espiègles
        s.bpm = 128
        s.inst(0, VIBES, 105); s.inst(1, PIZZ, 100); s.inst(2, BRASS, 85); s.inst(DR, 0, 85)
        s.seq(0, 0, ['C5', 'E5', 'G5', 'A5', 'G5', 'E5', 'G5', 'C6'], 0.25, 90, 1.5)
        s.seq(1, 0, ['C3', None, 'G3', None, 'A3', None, 'G3', None], 0.25, 90)
        s.ch(2, 2, chord('C', 4), 0.4, 90)
        s.ch(2, 2.5, chord('F', 4), 0.4, 90)
        s.ch(2, 3, chord('C', 4), 1.5, 100)
        s.n(DR, 3, TRI, 2, 90)
    elif kind == 'quatre':  # 4 à la suite : quatre coups qui montent
        s.bpm = 120
        s.inst(0, BRASS, 110); s.inst(1, TIMP, 110); s.inst(2, STRINGS, 90); s.inst(DR, 0, 100)
        for i, c in enumerate(['F', 'G', 'A', 'Bb']):
            s.ch(0, i * 0.5, chord(c, 3), 0.3, 85 + i * 10)
            s.n(1, i * 0.5, chord(c, 2)[0], 0.3, 100)
            s.n(DR, i * 0.5, KICK, 0.2, 100)
        s.ch(0, 2.25, chord('C', 4) + [N('C3')], 2, 115)
        s.ch(2, 2.25, chord('C', 4) + [N('E5')], 2.5, 90)
        s.n(DR, 2.25, CRASH, 2, 115)
    elif kind == 'fourchette':  # fourchette : piano qui mesure, cordes qui tranchent
        s.bpm = 104
        s.inst(0, PIANO, 110); s.inst(1, STRINGS, 90); s.inst(2, TIMP, 100); s.inst(DR, 0, 80)
        s.seq(0, 0, ['C4', 'G4', 'C5', 'G4', 'D5', 'G4', 'E5', None], 0.25, 85)
        s.seq(0, 0, ['C3', None, None, None, 'B2', None, None, None], 0.25, 75, 4)
        s.ch(1, 2, chord('Csus4', 4), 1, 80)
        s.ch(1, 3, chord('C', 4), 2, 90)
        s.n(2, 3, N('C2'), 1, 100)
        s.n(DR, 3, RIDE, 2, 70)
    elif kind == 'champions':  # duel des champions : épique, chœur et timbales
        s.bpm = 84
        s.inst(0, BRASS, 115); s.inst(1, CHOIR, 100); s.inst(2, TIMP, 120); s.inst(3, STRINGS, 95); s.inst(DR, 0, 110)
        for i in range(6):
            s.n(2, i * 0.25, N('D2'), 0.2, 70 + i * 9)
        s.ch(0, 1.5, chord('Dm', 3), 1, 100); s.ch(1, 1.5, chord('Dm', 4), 1.5, 95)
        s.ch(0, 2.5, chord('Bb', 3), 0.75, 105); s.ch(0, 3.25, chord('C', 3), 0.75, 110)
        s.ch(0, 4, chord('D', 3) + [N('D2')], 3, 120); s.ch(1, 4, chord('D', 4), 3, 110)
        s.ch(3, 4, chord('D', 4) + [N('A5')], 3, 100)
        s.n(2, 4, N('D2'), 1, 127); s.n(DR, 4, CRASH, 3, 120); s.n(DR, 4, KICK, 0.5, 120)
    else:  # duel : percussions graves et cuivres agressifs
        s.bpm = 132
        s.inst(0, TROMBONE, 115); s.inst(1, BRASS, 105); s.inst(DR, 0, 110)
        s.seq(DR, 0, [LTOM, LTOM, MTOM, LTOM, HTOM, MTOM, LTOM, None], 0.25, 100)
        s.seq(0, 0, ['E2', None, 'E2', 'G2', None, 'E2', 'Bb2', None], 0.25, 110)
        s.ch(1, 2, chord('Em', 3) + [N('E2')], 1.5, 115)
        s.n(DR, 2, CRASH, 2, 115); s.n(DR, 2, KICK, 0.3, 120)
    return s


CUES = {
    'opening': (opening, -13), 'victory': (victory, -13), 'transition': (transition, -15),
}
for k in ['sprint', 'mystere', 'eclair', 'table', 'quatre', 'fourchette', 'champions', 'duel']:
    CUES['round_' + k] = ((lambda k=k: round_jingle(k)), -14)


def main():
    for name, (make, lufs) in CUES.items():
        dest = render(make(), name, lufs)
        print(f'{name:18s} {os.path.getsize(dest) // 1024:4d} Ko', flush=True)
    # Les boucles de fond (scripts/import_music.py) sont gardées dans le manifeste.
    path = os.path.join(OUT, 'manifest.json')
    manifest = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            manifest = json.load(f)
    loops = manifest.get('loops', {})
    manifest['cues'] = sorted(set(CUES) | set(loops))
    manifest['loops'] = loops
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()

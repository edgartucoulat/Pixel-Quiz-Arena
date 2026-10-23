#!/usr/bin/env python3
"""PIXEL QUIZ ARENA - Enregistre la voix du présentateur (gratuit).

    pip install edge-tts      (et ffmpeg installé)
    python3 scripts/gen_voice.py

Utilise les voix neuronales gratuites de Microsoft (les mêmes que la lecture
à voix haute d'Edge) via edge-tts, puis compresse en Opus (~3 Ko/s).
Seules les phrases nouvelles sont enregistrées ; celles qui ne servent plus
sont supprimées. Lancé automatiquement par .github/workflows/voice.yml.
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile


ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'audio', 'voice')
# Changer de voix ré-enregistre tout. Garder js/voice.js (BANK_VOICE) d'accord.
VOICE = os.environ.get('PQA_VOICE', 'fr-CH-FabriceNeural')
JOBS = int(os.environ.get('PQA_JOBS', '6'))
# Ton par type de phrase (débit, hauteur) : une voix grave, des répliques
# plus enlevées que les questions, qui restent claires et posées.
STYLES = {'line': ('+10%', '-8Hz'), 'question': ('+4%', '-10Hz')}
# Son « plateau télé » : du corps dans le grave, voix plus présente (aigus de la parole), compressée
# comme à la radio, avec une toute petite salle autour.
PLATEAU = ('highpass=f=90,equalizer=f=130:t=q:w=1:g=3,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1.2:g=3.5,'
           'acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=3,'
           'aecho=0.85:0.6:23|41:0.10|0.06,alimiter=limit=0.95')
# Coupe les silences de début et de fin, garde une petite respiration.
FILTER = ('silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
          'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
          + PLATEAU + ',apad=pad_dur=0.12')
# Changer ceci (voix, ton ou traitement) ré-enregistre toute la banque.
SIGNATURE = f'{VOICE}|{STYLES}|{FILTER}'


def load_lines():
    res = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'voice-lines.js')],
                         check=True, capture_output=True, text=True)
    return json.loads(res.stdout)


async def synth(item, sem, tmp, stats):
    import edge_tts
    dest = os.path.join(OUT, item['id'] + '.webm')
    async with sem:
        for attempt in range(5):
            try:
                mp3 = os.path.join(tmp, item['id'] + '.mp3')
                rate, pitch = STYLES['question' if item['kind'] == 'question' else 'line']
                await edge_tts.Communicate(item['text'], VOICE, rate=rate, pitch=pitch).save(mp3)
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', mp3, '-af', FILTER, '-ac', '1',
                                '-c:a', 'libopus', '-b:a', '20k', '-application', 'voip', dest], check=True)
                os.remove(mp3)
                stats['done'] += 1
                if stats['done'] % 50 == 0:
                    print(f"  {stats['done']}/{stats['todo']}", flush=True)
                return True
            except Exception as e:  # réseau capricieux : on réessaie
                print(f"  ! {item['id']} essai {attempt + 1}: {e}", file=sys.stderr, flush=True)
                await asyncio.sleep(2 ** attempt)
    stats['failed'] += 1
    return False


async def main():
    os.makedirs(OUT, exist_ok=True)
    lines = load_lines()
    manifest_path = os.path.join(OUT, 'manifest.json')
    old = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            old = json.load(f)
    redo = old.get('voice') != VOICE or old.get('style') != SIGNATURE
    wanted = {it['id'] for it in lines}
    have = {f[:-5] for f in os.listdir(OUT) if f.endswith('.webm')}
    for stale in have - wanted:
        os.remove(os.path.join(OUT, stale + '.webm'))
    todo = [it for it in lines if redo or it['id'] not in have]
    print(f'{len(lines)} phrases, {len(todo)} à enregistrer avec {VOICE}', flush=True)
    stats = {'done': 0, 'failed': 0, 'todo': len(todo)}
    sem = asyncio.Semaphore(JOBS)
    with tempfile.TemporaryDirectory() as tmp:
        await asyncio.gather(*(synth(it, sem, tmp, stats) for it in todo))
    ids = sorted(i for i in wanted if os.path.exists(os.path.join(OUT, i + '.webm')))
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump({'voice': VOICE, 'style': SIGNATURE, 'ids': ids}, f, separators=(',', ':'))
        f.write('\n')
    print(f"{stats['done']} enregistrées, {stats['failed']} échecs, {len(ids)} au total", flush=True)
    # Quelques échecs ne bloquent pas : ces phrases seront dites en direct.
    if todo and stats['failed'] > len(todo) // 2:
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())

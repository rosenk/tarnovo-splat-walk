"""Viewer sidecar for the arcade splat: walk up the 36 m segment along the
forward looks, pause at the arcades, then walk back along the back looks.
Generated targets: 7 stops x (forward, left 55, right -55, back)."""
import json, math, sys
pose = [f['camera'] for f in json.load(open('s1-op.json'))['response']['frames']]
gen = [f['camera'] for f in json.load(open('a-op.json'))['response']['frames']]
key = lambda c, hold=0.3, label='': {'position': c['extrinsics']['position'], 'quaternion': c['extrinsics']['quaternion'], 'hold': hold, 'label': label}
up = [key(pose[2], 1.5, 'A3')] + [key(gen[4 * k]) for k in range(3)] + [key(gen[9], 2.5, 'arcades'), key(gen[8])] \
     + [key(gen[4 * k]) for k in range(3, 7)] + [key(pose[4], 1.2, 'A5')]
down = [key(gen[4 * k + 3], 0.5 if k == 6 else 0.3) for k in range(6, -1, -1)]
tour = up + down
I = pose[2]['intrinsics']
side = {'coordinateSystem': 'rub', 'vfov': round(math.degrees(2 * math.atan(I['height'] / 2 / I['fy'])), 2),
        'speed': 1.0, 'start': tour[0], 'tour': tour,
        'credits': 'Photos: Izvora, Wikimedia Commons, CC0 (Samovodska charshia 3, 4, 6)'}
json.dump(side, open(sys.argv[1], 'w'), indent=1)
print('wrote', sys.argv[1], len(tour), 'keys')

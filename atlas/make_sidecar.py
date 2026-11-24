"""Write the viewer sidecar (start camera + autopilot tour) for an Atlas splat.
usage: make_sidecar.py <out.json>
The tour visits the generated cameras in walking order; quaternions are RUB
camera-to-world, i.e. directly usable as three.js camera quaternions."""
import json
import math
import sys

pose = json.load(open('02-op.json'))['response']['frames'][0]['camera']
gen = [f['camera'] for f in json.load(open('03-op.json'))['response']['frames']]


def key(cam, hold=0.6, label=''):
    e = cam['extrinsics']
    return {'position': e['position'], 'quaternion': e['quaternion'], 'hold': hold, 'label': label}


def yaw_q(deg):
    h = math.radians(deg) / 2
    return [0.0, math.sin(h), 0.0, math.cos(h)]


# target layout from make_generate.py: 0-1 start pans, 2+3i..4+3i step i
# (centre look = 3+3i), 17-18 Tsarevets, 19 bend, 20-21 back down the lane
tour = [
    key(pose, 1.5, 'start'),
    key(gen[3]), key(gen[6]), key(gen[9]),
    key(gen[17], 3.0, 'Tsarevets'),
    key(gen[12]), key(gen[15]),
    key(gen[19], 1.5, 'bend'),
    key(gen[18], 3.0, 'Tsarevets'),
    key(gen[21], 1.0, 'back'), key(gen[20], 0.5, 'back'),
    {'position': pose['extrinsics']['position'], 'quaternion': yaw_q(175), 'hold': 0.3, 'label': 'turn'},
]
I = pose['intrinsics']
side = {
    'coordinateSystem': 'rub',
    'vfov': round(math.degrees(2 * math.atan(I['height'] / 2 / I['fy'])), 2),
    'start': tour[0],
    'tour': tour,
}
json.dump(side, open(sys.argv[1], 'w'), indent=1)
print('wrote', sys.argv[1], len(tour), 'keys, vfov', side['vfov'])

"""Viewer sidecar for the Samovodska splat: tour through the real photo
cameras up the street, then back down along the generated back views."""
import json, math, sys
pose = [f['camera'] for f in json.load(open('s1-op.json'))['response']['frames']]
gen = [f['camera'] for f in json.load(open('s2-op.json'))['response']['frames']]
key = lambda c, hold=0.4, label='': {'position': c['extrinsics']['position'], 'quaternion': c['extrinsics']['quaternion'], 'hold': hold, 'label': label}
# generated targets: 8 stops x (left 55, right -55, back 180)
tour = [key(pose[0], 1.5, 'A1'), key(pose[2]), key(gen[9], 2.0, 'arcades'), key(pose[3]), key(pose[4]),
        key(pose[5]), key(pose[6], 2.0, 'top'), key(gen[23], 0.5, 'back'), key(gen[17]), key(gen[11]),
        key(gen[5]), key(gen[2], 0.5)]
I = pose[0]['intrinsics']
side = {'coordinateSystem': 'rub', 'vfov': round(math.degrees(2 * math.atan(I['height'] / 2 / I['fy'])), 2),
        'speed': 1.4, 'start': tour[0], 'tour': tour,
        'credits': 'Photos: Izvora, Wikimedia Commons, CC0 (Samovodska charshia 1-8)'}
json.dump(side, open(sys.argv[1], 'w'), indent=1)
print('wrote', sys.argv[1], len(tour), 'keys, vfov', side['vfov'])

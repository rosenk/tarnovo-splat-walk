"""atlasGenerate request for Samovodska charshia: the 7 posed real photos as
context, 24 new views along the street between them (left, right and back
looks) so the walk can turn around. Forward looks are the real photos."""
import json, math
fr = json.load(open('s1-op.json'))['response']['frames']
intr = fr[0]['camera']['intrinsics']
P = {i: fr[i]['camera']['extrinsics']['position'] for i in range(7)}


def quat(yaw, pitch=0.0):
    y, p = math.radians(yaw) / 2, math.radians(pitch) / 2
    x1, y1, z1, w1 = 0.0, math.sin(y), 0.0, math.cos(y)
    x2, w2 = math.sin(p), math.cos(p)
    return [round(c, 6) for c in (w1 * x2, y1 * w2, -y1 * x2, w1 * w2)]


def lerp(a, b, t):
    return [a[k] + (b[k] - a[k]) * t for k in range(3)]


def heading(a, b):
    return math.degrees(math.atan2(-(b[0] - a[0]), -(b[2] - a[2])))


# walk A1 -> A3 -> A4 -> A5 -> A6 -> A7 (A2 is a side look next to A1)
path = [0, 2, 3, 4, 5, 6]
stops = [(0, 2, 0.0), (0, 2, 0.33), (0, 2, 0.66), (2, 3, 0.5), (3, 4, 0.6), (4, 5, 0.33), (4, 5, 0.66), (5, 6, 0.5)]
targets = []
for a, b, t in stops:
    pos = lerp(P[a], P[b], t)
    h = heading(P[a], P[b])
    for dy in (55, -55, 180):
        targets.append({'extrinsics': {'position': [round(v, 3) for v in pos], 'quaternion': quat(h + dy), 'coordinateSystem': 'rub'},
                        'intrinsics': {k: intr[k] for k in ('fx', 'fy', 'cx', 'cy', 'width', 'height')}})
req = {
    'contextFrames': [{'imageAsset': {'assetId': f['imageAsset']['assetId']},
                       'depth': {'depthAsset': {'assetId': f['depth']['depthAsset']['assetId']}},
                       'camera': f['camera']} for f in fr],
    'targetCameras': targets,
    'prompt': 'Samovodska charshia, the old crafts street in Veliko Tarnovo, Bulgaria: cobblestones, '
              'Bulgarian National Revival houses with stone ground floors, arcades, wooden shop fronts and '
              'white plastered upper floors under terracotta roofs. Real photograph, natural daylight. '
              'Empty street, no people, no cars.',
    'returnDepth': True,
}
json.dump(req, open('s2-generate.json', 'w'), indent=1)
print(len(req['contextFrames']), 'contexts,', len(targets), 'targets')

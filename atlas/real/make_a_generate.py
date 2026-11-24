"""Dense atlasGenerate + splats requests for the arcade segment of Samovodska
charshia (real photos A3, A4, A5, about 36 m of street).
Writes a-generate.json now; after a-op.json exists, `--splats` writes
a-splats-draft.json with a regionOfInterest box around the segment."""
import json, math, sys
fr = json.load(open('s1-op.json'))['response']['frames']
ctx = [fr[i] for i in (2, 3, 4)]
intr = ctx[0]['camera']['intrinsics']
P = [c['camera']['extrinsics']['position'] for c in ctx]


def quat(yaw):
    h = math.radians(yaw) / 2
    return [0.0, round(math.sin(h), 6), 0.0, round(math.cos(h), 6)]


def heading(a, b):
    return math.degrees(math.atan2(-(b[0] - a[0]), -(b[2] - a[2])))


seg = [math.dist(P[0], P[1]), math.dist(P[1], P[2])]
L = sum(seg)


def at(s):
    """Point and heading at arc length s along A3 -> A4 -> A5."""
    i = 0 if s <= seg[0] else 1
    t = (s if i == 0 else s - seg[0]) / seg[i]
    a, b = P[i], P[i + 1]
    return [a[k] + (b[k] - a[k]) * t for k in range(3)], heading(a, b)


cam = lambda pos, yaw: {'extrinsics': {'position': [round(v, 3) for v in pos], 'quaternion': quat(yaw), 'coordinateSystem': 'rub'},
                        'intrinsics': {k: intr[k] for k in ('fx', 'fy', 'cx', 'cy', 'width', 'height')}}
stops = [L * k / 6 for k in range(7)]  # every ~6 m
targets = []
for s in stops:
    pos, h = at(s)
    for dy in (0, 55, -55, 180):
        targets.append(cam(pos, h + dy))

frame = lambda f: {'imageAsset': {'assetId': f['imageAsset']['assetId']},
                   'depth': {'depthAsset': {'assetId': f['depth']['depthAsset']['assetId']}}, 'camera': f['camera']}
PROMPT = ('Samovodska charshia, the old crafts street in Veliko Tarnovo, Bulgaria: a stone arcade with round arches '
          'on the left, cobblestones, Bulgarian National Revival houses with white plastered upper floors, wooden '
          'shop fronts and terracotta roofs. Real photograph, natural daylight. Empty street, no people, no cars.')
if '--splats' not in sys.argv:
    json.dump({'contextFrames': [frame(f) for f in ctx], 'targetCameras': targets, 'prompt': PROMPT, 'returnDepth': True},
              open('a-generate.json', 'w'), indent=1)
    print('3 contexts, %d targets, segment %.1f m' % (len(targets), L))
else:
    gen = json.load(open('a-op.json'))['response']
    mid, h = at(L / 2)
    box = {'frame': {'position': [round(v, 3) for v in mid], 'quaternion': quat(h), 'coordinateSystem': 'rub'},
           'halfExtents': [9.0, 9.0, round(L / 2 + 14, 1)]}  # x across, y up, z along the street
    req = {'posedFrames': [frame(f) for f in ctx] + [frame(f) for f in gen['frames']],
           'prompt': gen['promptUsed'], 'enhancePrompt': False, 'refine': False, 'regionOfInterest': box}
    json.dump(req, open('a-splats-draft.json', 'w'), indent=1)
    print(len(req['posedFrames']), 'frames, box', box)

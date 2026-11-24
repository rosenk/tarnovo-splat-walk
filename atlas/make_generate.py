"""Build the atlasGenerate request for the Tarnovo lane.

Context: the posed view of image 1 (02-op.json). Targets: a slow walk up the
lane with left/centre/right looks at each step, two looks out over the parapet
toward Tsarevets, one look up the bend, and two looks back down the lane.

Measured from the posed depth (units ~ metres): camera at (0, 6.32, 0) looking
-Z, cobbles at y ~ 4.44 (eye 1.88 above), lane ~7 wide near the camera, corner
house ~13 ahead, lane bends uphill to the left, parapet gap on the right.
RUB camera axes; turning left is a positive rotation about +Y.
"""
import json
import math

pose = json.load(open('02-op.json'))['response']['frames'][0]
t2i = json.load(open('01-op.json'))['response']
cam0 = pose['camera']
intr = cam0['intrinsics']
EYE_Y = cam0['extrinsics']['position'][1]


def quat(yaw_deg, pitch_deg=0.0):
    """Yaw about +Y (left positive), then pitch about the camera's right axis."""
    y, p = math.radians(yaw_deg) / 2, math.radians(pitch_deg) / 2
    qy = (0.0, math.sin(y), 0.0, math.cos(y))
    qp = (math.sin(p), 0.0, 0.0, math.cos(p))
    x1, y1, z1, w1 = qy
    x2, y2, z2, w2 = qp
    q = (
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    )
    return [round(c, 6) for c in q]


def camera(x, z, yaw, pitch=0.0, rise=0.0):
    return {
        'extrinsics': {
            'position': [round(x, 3), round(EYE_Y + rise, 3), round(z, 3)],
            'quaternion': quat(yaw, pitch),
            'coordinateSystem': 'rub',
        },
        'intrinsics': {k: intr[k] for k in ('fx', 'fy', 'cx', 'cy', 'width', 'height')},
    }


targets = []
# small pans at the start position
targets += [camera(0, 0, 35), camera(0, 0, -35)]
# walk forward, snaking the look direction so neighbours overlap
steps = [(-0.15, -1.3), (-0.3, -2.6), (-0.45, -3.9), (-0.6, -5.2), (-0.8, -6.5)]
for i, (x, z) in enumerate(steps):
    rise = 0.04 * abs(z)  # the lane climbs
    base = [0, 0, 5, 10, 14][i]  # follow the lane as it bends left
    yaws = [35, 0, -35] if i % 2 == 0 else [-35, 0, 35]
    targets += [camera(x, z, base + yw, 2, rise) for yw in yaws]
# out over the parapet toward Tsarevets
targets += [camera(-0.3, -3.9, -50, 1, 0.16), camera(-0.8, -6.5, -55, 2, 0.26)]
# up the bend to the left
targets += [camera(-0.8, -6.5, 25, 4, 0.26)]
# looking back down the lane
targets += [camera(-0.6, -5.2, 160, 0, 0.21), camera(-0.8, -6.5, -165, 0, 0.26)]

req = {
    'contextFrames': [{
        'imageAsset': {'assetId': pose['imageAsset']['assetId']},
        'depth': {'depthAsset': {'assetId': pose['depth']['depthAsset']['assetId']}},
        'camera': cam0,
    }],
    'targetCameras': targets,
    'prompt': t2i['promptsUsed'][1],
    'enhancePrompt': False,
    'returnDepth': True,
}
json.dump(req, open('03-generate.json', 'w'), indent=1)
print(len(targets), 'target cameras -> 03-generate.json')

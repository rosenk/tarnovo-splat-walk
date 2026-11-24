"""Build the posedImages2Splats request: the posed context view + the 22 atlasGenerate views.
usage: make_splats.py [--refine]   (default: draft, refine=false, <= 32 frames)"""
import json
import sys

pose = json.load(open('02-op.json'))['response']['frames'][0]
gen = json.load(open('03-op.json'))['response']


def frame(f):
    return {
        'imageAsset': {'assetId': f['imageAsset']['assetId']},
        'depth': {'depthAsset': {'assetId': f['depth']['depthAsset']['assetId']}},
        'camera': f['camera'],
    }


frames = [frame(pose)] + [frame(f) for f in gen['frames']]
refine = '--refine' in sys.argv
req = {
    'posedFrames': frames,
    'prompt': gen['promptUsed'],
    'enhancePrompt': False,
    'refine': refine,
}
out = '05-splats-refined.json' if refine else '04-splats-draft.json'
json.dump(req, open(out, 'w'), indent=1)
print(len(frames), 'frames, refine =', refine, '->', out)

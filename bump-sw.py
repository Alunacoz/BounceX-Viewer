# bump-sw.py — run this before starting the server
import re, time

version = int(time.time())
file = 'sw.js'

with open(file, 'r') as f:
    content = f.read()

updated = re.sub(
    r"const CACHE_NAME = 'bx-video-v[\w-]+'",
    f"const CACHE_NAME = 'bx-video-v{version}'",
    content
)

with open(file, 'w') as f:
    f.write(updated)

print(f'✓ Cache version bumped to bx-video-v{version}')

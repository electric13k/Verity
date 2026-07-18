"""Generated gRPC stubs (see packages/proto/generate.sh).

The generated modules import each other as `verity.v1.*`, so this package
root goes on sys.path. Import `app.pb` before importing `verity.v1`.
"""

import os
import sys

_here = os.path.dirname(__file__)
if _here not in sys.path:
    sys.path.insert(0, _here)

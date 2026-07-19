"""OS-isolated skill script execution — honest limits, no security theater.

Third-party skills are untrusted code. Without Docker we cannot build a full
sandbox, so this module enforces the strongest containment available to an
unprivileged process on Linux and REFUSES to run when the load-bearing
control (network isolation) is missing.

What this DOES enforce (Stage A, no Docker):
  - **Network isolation** — each run executes inside a fresh network
    namespace via ``unshare -rn`` (unprivileged user+net namespace). The
    namespace has only a loopback interface and no route off the box, so a
    hostile skill that reads local data has nowhere to exfiltrate it.
    Availability is probed once (see :func:`network_isolation_available`).
    If it is unavailable, third-party skills are refused unless the
    ``VERITY_SKILLS_UNSAFE_ALLOW=1`` dev override is set (logged loudly once).
  - **Resource limits** (``preexec_fn`` / ``setrlimit`` in the child) —
    CPU seconds (RLIMIT_CPU), address space (RLIMIT_AS), output file size
    (RLIMIT_FSIZE), and process count (RLIMIT_NPROC): caps runaway compute,
    memory bombs, oversized writes, and fork bombs.
  - **Dedicated per-run working directory** (``mkdtemp``, removed after the
    run) — the script's cwd is a throwaway dir, never the skill directory or
    any data root.
  - **Scrubbed, near-empty environment** — no service env or secrets reach
    scripts (only PATH/HOME/LANG).
  - **Path-jail** — the script must resolve to a file inside the skill
    directory (symlinks resolved first).
  - **Incremental output cap** (``MAX_OUTPUT_BYTES``) — stdout is read in
    chunks and the process is killed the instant it exceeds the cap; output
    is never fully buffered in memory before the check (audit M4).
  - **Wall-clock timeout.**
  - stdout/stderr are EXTERNAL CONTENT: BOP-sanitized and wrapUntrusted
    before they can enter any prompt.

What this does NOT do (documented honestly):
  - **No filesystem read isolation.** Without a mount namespace / chroot /
    container, the script can still READ any path readable by this process.
    The network namespace is what makes that tolerable: a skill may read but
    has no route to send anything anywhere. As the one FS-exposure case we
    can cheaply prevent, we additionally REFUSE to run when a known data root
    (e.g. ``OBSIDIAN_VAULT_PATH``) is nested within the skill's own reachable
    tree — where a script could reach it by a predictable relative path.

ponytail: full container isolation (rootless Podman / gVisor per run, a
read-only rootfs and no vault mount) at Stage C alongside mTLS.
"""

import asyncio
import functools
import logging
import os
import resource
import shutil
import signal
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.bop import sanitize_machinery
from app.skills.loader import Skill
from app.wrap import wrap_untrusted

logger = logging.getLogger(__name__)

MAX_OUTPUT_BYTES = 64 * 1024
_READ_CHUNK = 8 * 1024

# Resource ceilings applied in the child before exec (best-effort; a limit
# the kernel rejects is skipped rather than aborting the run).
MAX_ADDRESS_SPACE = 1024 * 1024 * 1024   # 1 GiB virtual memory
MAX_FILE_SIZE = 32 * 1024 * 1024         # 32 MiB single-file write cap
MAX_NPROC = 256                          # fork-bomb guard
_CPU_HEADROOM_SECONDS = 2                # RLIMIT_CPU above the wall-clock timeout

SCRUBBED_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8"}

# Filesystem data roots whose exposure inside a skill's reachable tree we can
# cheaply detect and refuse. These are path-valued config env vars only.
_DATA_ROOT_ENV_VARS = ("OBSIDIAN_VAULT_PATH",)

_UNSAFE_ALLOW_ENV = "VERITY_SKILLS_UNSAFE_ALLOW"
_unsafe_warned = False


class SkillExecutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SkillResult:
    exit_code: int
    output: str  # wrapped + sanitized, prompt-safe


@functools.lru_cache(maxsize=1)
def network_isolation_available() -> bool:
    """True if we can launch a child in an isolated network namespace with no
    route off the box. Probed once (unprivileged user+net namespace via
    ``unshare -rn``); the result is cached for the process lifetime."""
    if not shutil.which("unshare"):
        return False
    try:
        proc = subprocess.run(
            ["unshare", "-rn", "--", "true"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


def _jailed_script(skill: Skill, script_rel: str) -> Path:
    script = (skill.path / script_rel).resolve()
    if not script.is_relative_to(skill.path):
        raise SkillExecutionError(f"script escapes skill directory: {script_rel}")
    if not script.is_file():
        raise SkillExecutionError(f"no such script: {script_rel}")
    return script


def _refuse_if_data_root_reachable(skill: Skill) -> None:
    """Refuse when a known filesystem data root is nested within (or contains)
    the skill directory — the FS-exposure case we can prevent without a mount
    namespace."""
    for var in _DATA_ROOT_ENV_VARS:
        raw = os.environ.get(var)
        if not raw:
            continue
        try:
            root = Path(raw).resolve()
        except OSError:
            continue
        if not root.exists():
            continue
        if (
            root == skill.path
            or root.is_relative_to(skill.path)
            or skill.path.is_relative_to(root)
        ):
            raise SkillExecutionError(
                f"refusing to run skill {skill.name!r}: data root {var} ({root}) "
                f"is nested within the skill's reachable tree ({skill.path})"
            )


def _guard_network_isolation(skill: Skill, allow_unsafe: bool | None) -> None:
    if network_isolation_available():
        return
    if allow_unsafe is None:
        allow_unsafe = os.environ.get(_UNSAFE_ALLOW_ENV) == "1"
    if not allow_unsafe:
        raise SkillExecutionError(
            "network isolation unavailable (no usable unshare / unprivileged "
            "network namespace); refusing to run third-party skill "
            f"{skill.name!r}. Set {_UNSAFE_ALLOW_ENV}=1 to override (dev only, "
            "unsafe)."
        )
    global _unsafe_warned
    if not _unsafe_warned:
        _unsafe_warned = True
        logger.warning(
            "SECURITY: %s=1 is set — running third-party skills WITHOUT network "
            "isolation. A hostile skill can read local data and exfiltrate it. "
            "Never enable this in production.",
            _UNSAFE_ALLOW_ENV,
        )


def _resource_limits(timeout: float):
    cpu_seconds = int(timeout) + _CPU_HEADROOM_SECONDS

    def _apply() -> None:
        for res, soft_hard in (
            (resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds)),
            (resource.RLIMIT_AS, (MAX_ADDRESS_SPACE, MAX_ADDRESS_SPACE)),
            (resource.RLIMIT_FSIZE, (MAX_FILE_SIZE, MAX_FILE_SIZE)),
            (resource.RLIMIT_NPROC, (MAX_NPROC, MAX_NPROC)),
        ):
            try:
                resource.setrlimit(res, soft_hard)
            except (ValueError, OSError):
                # A limit the kernel won't accept must not abort the run; the
                # remaining limits and network isolation still apply.
                pass

    return _apply


def _isolated_argv(script: Path, args: list[str] | None) -> list[str]:
    inner = ["/bin/sh", str(script), *(args or [])]
    if network_isolation_available():
        return ["unshare", "-rn", "--", *inner]
    return inner


async def _terminate(proc: asyncio.subprocess.Process) -> None:
    """Kill the whole process group and reap it. Killing the group (not just
    the launcher) takes down orphaned pipeline children — e.g. a writer
    blocked on a full stdout pipe. We then drain stdout to EOF: once every
    writer is dead the pipe closes, the transport finishes cleanly, and
    ``wait()`` returns without the reap race that a bare wait can hit."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    if proc.stdout is not None:
        try:
            while await proc.stdout.read(_READ_CHUNK):
                pass
        except (ValueError, asyncio.CancelledError):
            pass
    try:
        await proc.wait()
    except ProcessLookupError:
        pass


async def _read_capped(stream: asyncio.StreamReader, limit: int) -> tuple[bytes, bool]:
    """Read up to ``limit`` bytes incrementally. Returns (data, exceeded).
    Stops the moment the cap is passed — output is never fully buffered
    before the check."""
    chunks: list[bytes] = []
    total = 0
    while total <= limit:
        chunk = await stream.read(_READ_CHUNK)
        if not chunk:
            return b"".join(chunks), False
        total += len(chunk)
        chunks.append(chunk)
    joined = b"".join(chunks)
    return joined[:limit], True


async def run_script(
    skill: Skill,
    script_rel: str,
    args: list[str] | None = None,
    timeout: float = 30.0,
    *,
    allow_unsafe: bool | None = None,
) -> SkillResult:
    """Run a skill script under the strongest isolation available.

    ``allow_unsafe`` forces (True) or forbids (False) running without network
    isolation; the default (None) consults ``VERITY_SKILLS_UNSAFE_ALLOW``.
    """
    script = _jailed_script(skill, script_rel)
    _refuse_if_data_root_reachable(skill)
    _guard_network_isolation(skill, allow_unsafe)

    workdir = Path(tempfile.mkdtemp(prefix="verity-skill-"))
    try:
        proc = await asyncio.create_subprocess_exec(
            *_isolated_argv(script, args),
            cwd=workdir,
            env=SCRUBBED_ENV,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            preexec_fn=_resource_limits(timeout),
            start_new_session=True,  # own process group -> group-kill on abort
        )
        try:
            raw, exceeded = await asyncio.wait_for(
                _read_capped(proc.stdout, MAX_OUTPUT_BYTES), timeout=timeout
            )
        except asyncio.TimeoutError:
            await _terminate(proc)
            raise SkillExecutionError(f"script timed out after {timeout}s: {script_rel}")
        if exceeded:
            await _terminate(proc)
            raise SkillExecutionError(
                f"script exceeded output cap ({MAX_OUTPUT_BYTES} bytes): {script_rel}"
            )
        await proc.wait()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    text = raw.decode(errors="replace")
    return SkillResult(
        exit_code=proc.returncode or 0,
        output=wrap_untrusted(
            sanitize_machinery(text), source=f"skill:{skill.name}:{script_rel}"
        ),
    )

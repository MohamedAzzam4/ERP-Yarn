#!/usr/bin/env python3
"""
WP-08-01F Task 3 — Server termination diagnostic.

Starts `next start` with explicit child-process management and captures:
- exact start command (values redacted)
- PID
- start timestamp
- listening port
- stdout/stderr log paths
- health checks at 1, 5, 15, 30, 60 seconds
- process existence at each check
- exit code/signal if it terminates
- memory usage over time
- whether the parent shell ended first
- port-conflict result
- relevant OS OOM evidence

Does NOT set --max-old-space-size. Uses the production build only.
"""
import os, sys, time, json, subprocess, signal, resource
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parent.parent.parent  # ERP-Yarn root
LOG_DIR = REPO / "docs/ui-ux/evidence/wp-08-01f/runs/server-diagnostic"
LOG_DIR.mkdir(parents=True, exist_ok=True)

STDOUT_LOG = LOG_DIR / "server-stdout.log"
STDERR_LOG = LOG_DIR / "server-stderr.log"
DIAGNOSTIC_LOG = LOG_DIR / "diagnostic.json"

PORT = 3000

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

def check_port_listening(port):
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1)
    try:
        result = s.connect_ex(("127.0.0.1", port))
        s.close()
        return result == 0
    except:
        s.close()
        return False

def check_process_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # process exists but we can't signal it

def get_memory_usage(pid):
    try:
        # Read /proc/<pid>/status for VmRSS, VmSize
        with open(f"/proc/{pid}/status") as f:
            status = f.read()
        vm_rss = vm_size = None
        oom_score = None
        for line in status.split("\n"):
            if line.startswith("VmRSS:"):
                vm_rss = int(line.split()[1]) * 1024  # kB to bytes
            elif line.startswith("VmSize:"):
                vm_size = int(line.split()[1]) * 1024
            elif line.startswith("VmPeak:"):
                pass
            elif line.startswith("OomScore:"):
                oom_score = int(line.split()[1])
        return {"vm_rss_bytes": vm_rss, "vm_size_bytes": vm_size, "oom_score": oom_score}
    except:
        return None

def check_oom_kills():
    """Check dmesg for OOM killer evidence (may require privileges)."""
    try:
        result = subprocess.run(["dmesg"], capture_output=True, text=True, timeout=5)
        oom_lines = [l for l in result.stdout.split("\n") if "oom" in l.lower() or "killed process" in l.lower()]
        return oom_lines[-5:] if oom_lines else []
    except:
        return ["(dmesg not accessible — may require privileges)"]

def check_journalctl_oom():
    """Check journalctl for OOM evidence."""
    try:
        result = subprocess.run(
            ["journalctl", "--since", "5 minutes ago", "--no-pager"],
            capture_output=True, text=True, timeout=10
        )
        oom_lines = [l for l in result.stdout.split("\n") if "oom" in l.lower() or "killed" in l.lower()]
        return oom_lines[-5:] if oom_lines else []
    except:
        return ["(journalctl not accessible)"]

def health_check(port):
    """Check if the server responds with any HTTP status."""
    import urllib.request
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/")
        resp = urllib.request.urlopen(req, timeout=5)
        return {"status_code": resp.status, "ok": True}
    except urllib.error.HTTPError as e:
        return {"status_code": e.code, "ok": True}  # any HTTP response means server is alive
    except Exception as e:
        return {"status_code": None, "ok": False, "error": str(e)}

def main():
    git_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(REPO)).decode().strip()

    diagnostic = {
        "startCommand": "next start -p 3000 (values redacted — env vars not shown)",
        "gitSha": git_sha,
        "port": PORT,
        "startTime": now_iso(),
        "envPresent": {
            "NEXT_PUBLIC_SUPABASE_URL": bool(os.environ.get("NEXT_PUBLIC_SUPABASE_URL")),
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": bool(os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")),
            "SUPABASE_SECRET_KEY": bool(os.environ.get("SUPABASE_SECRET_KEY")),
            "DATABASE_URL": bool(os.environ.get("DATABASE_URL")),
            "SUPABASE_PROJECT_REF": bool(os.environ.get("SUPABASE_PROJECT_REF")),
        },
        "stdoutLogPath": str(STDOUT_LOG),
        "stderrLogPath": str(STDERR_LOG),
        "checks": [],
        "termination": None,
        "oomEvidence": None,
    }

    print(f"=== WP-08-01F Task 3 — Server Termination Diagnostic ===")
    print(f"Start time: {diagnostic['startTime']}")
    print(f"Git SHA: {git_sha}")
    print(f"Port: {PORT}")
    print(f"Env present: {json.dumps(diagnostic['envPresent'])}")
    print(f"Stdout log: {STDOUT_LOG}")
    print(f"Stderr log: {STDERR_LOG}")
    print()

    # Check for port conflict before starting
    port_in_use = check_port_listening(PORT)
    print(f"Pre-start port check: {'IN USE' if port_in_use else 'FREE'}")
    if port_in_use:
        diagnostic["portConflict"] = "Port 3000 is already in use before starting"
        print("ERROR: Port 3000 already in use — aborting")
        with open(DIAGNOSTIC_LOG, "w") as f:
            json.dump(diagnostic, f, indent=2)
        sys.exit(1)

    # Start the server using subprocess.Popen (keeps the child attached)
    # Do NOT use setsid or disown — we want to track the child explicitly.
    print("Starting server: next start -p 3000")
    stdout_f = open(STDOUT_LOG, "w")
    stderr_f = open(STDERR_LOG, "w")

    proc = subprocess.Popen(
        ["npx", "next", "start", "-p", str(PORT)],
        cwd=str(REPO),
        stdout=stdout_f,
        stderr=stderr_f,
        # Do NOT use start_new_session=True — keep the child in our process group
    )

    diagnostic["pid"] = proc.pid
    print(f"Server PID: {proc.pid}")

    # Health checks at 1, 5, 15, 30, 60 seconds
    check_intervals = [1, 5, 15, 30, 60]
    start_time = time.time()

    for interval in check_intervals:
        elapsed = time.time() - start_time
        sleep_time = max(0, interval - elapsed)
        if sleep_time > 0:
            time.sleep(sleep_time)

        check_time = now_iso()
        alive = check_process_alive(proc.pid)
        port_listening = check_port_listening(PORT)
        health = health_check(PORT) if port_listening else {"status_code": None, "ok": False, "error": "port not listening"}
        mem = get_memory_usage(proc.pid) if alive else None
        poll_result = proc.poll()  # None if still running, else exit code

        check = {
            "time": check_time,
            "elapsedSeconds": round(time.time() - start_time, 1),
            "processAlive": alive,
            "portListening": port_listening,
            "healthCheck": health,
            "memory": mem,
            "pollExitCode": poll_result,
        }
        diagnostic["checks"].append(check)

        print(f"  [{check['elapsedSeconds']}s] alive={alive} port={port_listening} http={health.get('status_code')} "
              f"rss={mem['vm_rss_bytes']//1024 if mem and mem.get('vm_rss_bytes') else '?'}kB "
              f"oom_score={mem.get('oom_score') if mem else '?'} "
              f"exit={poll_result}")

        if not alive:
            # Process died — capture exit info
            exit_code = proc.returncode
            diagnostic["termination"] = {
                "time": check_time,
                "elapsedSeconds": check["elapsedSeconds"],
                "exitCode": exit_code,
                "signal": -exit_code if exit_code and exit_code < 0 else None,
            }
            print(f"\n  PROCESS TERMINATED at {check['elapsedSeconds']}s")
            print(f"  Exit code: {exit_code}")
            if exit_code and exit_code < 0:
                sig = -exit_code
                sig_name = signal.Signals(sig).name if sig in signal.Signals._value2member_map_ else f"signal {sig}"
                print(f"  Signal: {sig_name} ({sig})")
            break

    # If process is still alive after all checks, terminate it
    if proc.poll() is None:
        print("\n  Server survived 60 seconds — terminating for cleanup")
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        diagnostic["termination"] = {
            "time": now_iso(),
            "elapsedSeconds": round(time.time() - start_time, 1),
            "exitCode": proc.returncode,
            "signal": "terminated by diagnostic script (survived 60s)",
            "classification": "server_healthy",
        }

    stdout_f.close()
    stderr_f.close()

    # Capture stdout/stderr content
    stdout_content = STDOUT_LOG.read_text()
    stderr_content = STDERR_LOG.read_text()
    diagnostic["stdoutContent"] = stdout_content[-2000:] if len(stdout_content) > 2000 else stdout_content
    diagnostic["stderrContent"] = stderr_content[-2000:] if len(stderr_content) > 2000 else stderr_content

    # Check for OOM evidence
    diagnostic["oomEvidence"] = {
        "dmesg": check_oom_kills(),
        "journalctl": check_journalctl_oom(),
    }

    # Classify the failure
    if diagnostic.get("termination"):
        term = diagnostic["termination"]
        exit_code = term.get("exitCode")
        signal = term.get("signal")

        if term.get("classification") == "server_healthy":
            classification = "server_healthy (survived 60s)"
        elif signal == signal.SIGKILL or (isinstance(signal, int) and signal == 9):
            classification = "OS_OOM_KILL (SIGKILL — likely OOM killer)"
        elif signal == signal.SIGTERM or (isinstance(signal, int) and signal == 15):
            classification = "SIGTERM (external termination)"
        elif exit_code == 1:
            # Check stderr for startup errors
            if "EADDRINUSE" in stderr_content:
                classification = "port_conflict"
            elif "module not found" in stderr_content.lower() or "cannot find" in stderr_content.lower():
                classification = "startup_exception (missing module)"
            else:
                classification = "startup_exception (exit code 1)"
        elif exit_code is None:
            classification = "parent_shell_child_cleanup (process disappeared without exit code)"
        else:
            classification = f"unknown (exit code {exit_code}, signal {signal})"

        diagnostic["classification"] = classification
        print(f"\n  CLASSIFICATION: {classification}")

    # Save diagnostic
    with open(DIAGNOSTIC_LOG, "w") as f:
        json.dump(diagnostic, f, indent=2)

    print(f"\n  Diagnostic saved: {DIAGNOSTIC_LOG}")

    # Print final env status
    print(f"\n  Env present: {json.dumps(diagnostic['envPresent'])}")

if __name__ == "__main__":
    main()

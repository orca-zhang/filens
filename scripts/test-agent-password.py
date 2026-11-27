"""Exercise hidden CLI password input on a Unix pseudo-terminal."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "packages/converter-client/test/fixtures/password/agile.docx"
PASSWORD = " filens 密码🔐 ".encode()
PROMPT = b"Document password: "


def read_terminal(fd, wait):
    if not select.select([fd], [], [], wait)[0]:
        return b""
    try:
        return os.read(fd, 4096)
    except OSError as error:
        if error.errno != errno.EIO:
            raise
        return b""


def interactive(args, typed):
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        pid, terminal = pty.fork()
        if pid == 0:
            try:
                os.dup2(output.fileno(), 1)
                os.dup2(errors.fileno(), 2)
                os.execv(args[0], list(map(os.fspath, args)))
            finally:
                os._exit(127)

        reaped = False
        screen = b""
        try:
            deadline = time.monotonic() + 10
            while PROMPT not in screen or termios.tcgetattr(terminal)[3] & termios.ECHO:
                assert time.monotonic() < deadline, screen
                screen += read_terminal(terminal, 0.02)
            os.write(terminal, typed)
            deadline = time.monotonic() + 120
            while not reaped:
                assert time.monotonic() < deadline, screen
                screen += read_terminal(terminal, 0.02)
                reaped, status = os.waitpid(pid, os.WNOHANG)
            while chunk := read_terminal(terminal, 0):
                screen += chunk
            assert termios.tcgetattr(terminal)[3] & termios.ECHO
        finally:
            os.close(terminal)
            if not reaped:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)

        output.seek(0)
        errors.seek(0)
        stdout, stderr = output.read(), errors.read()
        assert screen.count(PROMPT) == 1
        assert not stderr, stderr
        for secret in [PASSWORD, b"incorrect"]:
            assert secret not in screen and secret not in stdout
        return os.waitstatus_to_exitcode(status), json.loads(stdout)


def main():
    binary = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="filens-terminal-") as directory:
        output = Path(directory) / "result.docx"
        args = [binary, "convert", INPUT, output, "--ask-password", "--workspace", "disk", "--json"]
        no_terminal = subprocess.run(
            args, stdin=subprocess.DEVNULL, capture_output=True, start_new_session=True, timeout=10,
        )
        assert no_terminal.returncode == 2 and not no_terminal.stderr
        assert json.loads(no_terminal.stdout)["error"]["code"] == "password_input_unavailable"
        assert not output.exists()

        for entered, status, code in [
            (b"\x03", 1, "canceled"),
            (b"\x04", 1, "canceled"),
            (b"incorrect\n", 3, "password_invalid"),
        ]:
            actual, result = interactive(args, entered)
            assert (actual, result["error"]["code"]) == (status, code), result
            assert not output.exists()

        status, result = interactive(args, PASSWORD + b"\n")
        assert status == 0 and result["ok"], result
        with ZipFile(output) as document:
            assert b"Fixture DOCX document" in document.read("word/document.xml")

    print("Hidden CLI password: terminal restoration, Unicode, retry, cancellation and non-terminal errors verified.")


if __name__ == "__main__":
    main()

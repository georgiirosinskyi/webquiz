import pytest
import socket
import subprocess
import time
import tempfile
import shutil
import os
import yaml
from contextlib import contextmanager


# Test servers listen on IPv4 only. On Windows "localhost" resolves to ::1 first,
# and every refused IPv6 attempt costs ~2s before the IPv4 fallback, so tests
# resolve "localhost" to IPv4 only.
_original_getaddrinfo = socket.getaddrinfo


def _ipv4_localhost_getaddrinfo(host, *args, **kwargs):
    if host == "localhost":
        return [info for info in _original_getaddrinfo(host, *args, **kwargs) if info[0] == socket.AF_INET]
    return _original_getaddrinfo(host, *args, **kwargs)


socket.getaddrinfo = _ipv4_localhost_getaddrinfo


# Predefined ports for parallel testing (8 workers max)
TEST_PORTS = [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087]


def get_worker_port():
    """Get port based on pytest worker ID."""
    # Try to get worker ID from pytest-xdist
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")

    if worker_id == "master":
        return TEST_PORTS[0]

    # Extract worker number from worker_id like 'gw0', 'gw1', etc.
    if isinstance(worker_id, str) and worker_id.startswith("gw"):
        try:
            worker_index = int(worker_id[2:])
            return TEST_PORTS[worker_index % len(TEST_PORTS)]
        except (ValueError, IndexError):
            return TEST_PORTS[0]

    return TEST_PORTS[0]


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing and change to it."""
    old_cwd = os.getcwd()
    temp_dir = tempfile.mkdtemp()
    os.chdir(temp_dir)
    try:
        yield temp_dir
    finally:
        os.chdir(old_cwd)
        shutil.rmtree(temp_dir)


@contextmanager
def custom_webquiz_server(config=None, quizzes=None):
    """Context manager for creating webquiz servers with custom configurations.

    Args:
        config: Full configuration dictionary (uses default if None)
        quizzes: Dictionary of quiz_filename -> quiz_data (uses default if None)

    Yields:
        Tuple of (process, port)
    """
    port = get_worker_port()

    # Create default config with port-specific directories to avoid conflicts
    default_config = {
        "server": {"port": port},
        "paths": {
            "quizzes_dir": f"quizzes_{port}",
            "logs_dir": f"logs_{port}",
            "csv_dir": f"data_{port}",
            "static_dir": f"static_{port}",
        },
        "admin": {"master_key": "test123", "trusted_ips": []},
    }

    # Default quiz set
    default_quizzes = {
        "test_quiz.yaml": {
            "title": "Test Quiz",
            "description": "A test quiz for admin API testing",
            "questions": [{"question": "What is 2 + 2?", "options": ["3", "4", "5", "6"], "correct_answer": 1}],
        }
    }

    # Start with default config and deep merge with provided config
    final_config = default_config.copy()
    if config is not None:

        def deep_merge(base, override):
            """Deep merge configuration dictionaries."""
            for key, value in override.items():
                if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                    deep_merge(base[key], value)
                else:
                    base[key] = value

        deep_merge(final_config, config)

    # Always ensure port is set correctly
    final_config["server"]["port"] = port

    # Use provided quizzes or default
    final_quizzes = quizzes if quizzes is not None else default_quizzes

    # Create quiz directory and quiz files
    quizzes_dir = final_config["paths"]["quizzes_dir"]
    os.makedirs(quizzes_dir, exist_ok=True)

    for quiz_filename, quiz_data in final_quizzes.items():
        quiz_file_path = os.path.join(quizzes_dir, quiz_filename)
        with open(quiz_file_path, "w") as f:
            yaml.dump(quiz_data, f)

    # Write config file
    config_filename = f"custom_config_{port}.yaml"
    with open(config_filename, "w") as f:
        yaml.dump(final_config, f)

    # Check if port is already in use before starting server
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.1)
        result = sock.connect_ex(("localhost", port))
        if result == 0:
            raise RuntimeError(
                f"Port {port} is already in use! Another webquiz server or process "
                f"is running on this port. Please stop it before running tests."
            )

    # Start server using sys.executable to ensure we use the same Python interpreter
    import sys

    # Enable coverage tracking for subprocess
    env = os.environ.copy()
    # Set COVERAGE_PROCESS_START to enable subprocess coverage tracking
    # Coverage.py will read configuration from pyproject.toml
    pyproject_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pyproject.toml")
    if os.path.exists(pyproject_path):
        env["COVERAGE_PROCESS_START"] = pyproject_path

    # Server output goes to a file: nobody reads a PIPE while the test runs, and
    # on Windows the small pipe buffer fills up and blocks the server on its next log write
    cmd = [sys.executable, "-m", "webquiz.cli", "--config", config_filename]
    output_filename = f"server_output_{port}.log"
    output_file = open(output_filename, "w")
    proc = subprocess.Popen(cmd, stdout=output_file, stderr=subprocess.STDOUT, text=True, env=env)

    try:
        # Wait for server to be ready
        max_attempts = 150
        for _ in range(max_attempts):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.settimeout(0.1)
                    result = sock.connect_ex(("localhost", port))
                    if result == 0:  # Port is open
                        break
            except (socket.error, OSError):
                pass
            time.sleep(0.1)
        else:
            # Server failed to start
            proc.kill()
            proc.wait()
            output_file.flush()
            with open(output_filename) as f:
                output = f.read()
            raise Exception(f"Server failed to start within {max_attempts * 0.1}s\nOUTPUT: {output}")

        yield proc, port

    finally:
        # Cleanup server process
        if proc.poll() is None:  # Process is still running
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        output_file.close()

        # On Windows sys.executable in a venv is a launcher that runs the real
        # interpreter as a child, so the server can still hold the port for a
        # moment after proc exits. Wait for it, or the next test sees "port in use".
        for _ in range(50):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.1)
                if sock.connect_ex(("localhost", port)) != 0:
                    break
            time.sleep(0.1)

        # Cleanup directories and config file to prevent data contamination between tests
        try:
            for directory in [
                quizzes_dir,
                final_config["paths"]["logs_dir"],
                final_config["paths"]["csv_dir"],
                final_config["paths"]["static_dir"],
            ]:
                if os.path.exists(directory):
                    shutil.rmtree(directory)

            for filename in [config_filename, output_filename]:
                if os.path.exists(filename):
                    os.remove(filename)
        except Exception as e:
            # Log cleanup errors but don't fail the test
            print(f"Warning: Cleanup error: {e}")


def get_admin_session(port, master_key="test123"):
    """Authenticate with admin API and return session cookies.

    Args:
        port: Server port
        master_key: Master key for authentication (default: "test123")

    Returns:
        requests.cookies.RequestsCookieJar with admin_session cookie
    """
    import requests

    response = requests.post(
        f"http://localhost:{port}/api/admin/auth",
        json={"master_key": master_key}
    )
    if response.status_code != 200:
        raise Exception(f"Failed to authenticate: {response.status_code} - {response.text}")
    return response.cookies

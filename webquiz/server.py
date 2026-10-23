import asyncio
import httpx
import html
import json
import csv
import yaml
from ruamel.yaml import YAML as RuamelYAML
import os
import socket
import subprocess
import platform
import zipfile
import tempfile
import shutil
import random
import secrets
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional
from aiohttp import web, WSMsgType
import aiofiles
import logging
from io import StringIO
import ipaddress
from importlib import resources

from .config import DEFAULT_BACKGROUND_COLOR, WebQuizConfig, load_config_from_yaml
from .translations import admin_text, get_translations
from .tunnel import TunnelManager
from .transfer import TransferManager, TransferError

from webquiz import __version__ as package_version
from webquiz import checker as checker_module

# Logger will be configured in create_app() with custom log file
logger = logging.getLogger(__name__)


def read_package_resource(filename: str) -> str:
    """Read a file from the webquiz package resources.

    Args:
        filename: Name of the resource file to read

    Returns:
        Content of the resource file as string

    Raises:
        Various exceptions if file cannot be read
    """
    try:
        # Try modern importlib.resources first (Python 3.9+)
        import importlib.resources as pkg_resources

        return (pkg_resources.files("webquiz") / filename).read_text(encoding="utf-8")
    except (ImportError, AttributeError):
        # Fallback to pkg_resources for older Python versions
        import pkg_resources

        return pkg_resources.resource_string("webquiz", filename).decode("utf-8")

def copy_resource(filename: str, dst_dir: Path):
    dst_dir.mkdir(parents=True, exist_ok=True)

    dst_file = dst_dir / Path(filename).name

    if dst_file.exists():
        return

    with resources.as_file(resources.files("webquiz") / filename) as src:
        shutil.copy2(src, dst_file)


# Pages built from frontend/ (React + antd) by `npm run build`; PyInstaller and the wheel ship them
UI_DIR = Path(str(resources.files("webquiz") / "ui"))
UI_DATA_MARKER = "<!--WEBQUIZ_DATA-->"
UI_PAGES = ["live-stats.html", "admin.html", "quiz.html"]


HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def config_form_data(parsed) -> dict:
    """Parts of a parsed config file the settings form edits (language, CSV, registration, appearance)."""
    if not isinstance(parsed, dict):
        parsed = {}
    registration = parsed.get("registration")
    appearance = parsed.get("appearance")
    if not isinstance(appearance, dict):
        appearance = {}
    return {
        "language": parsed.get("language", "uk"),
        "extra_answers_with_users_csv": bool(parsed.get("extra_answers_with_users_csv", False)),
        "question_navigation": bool(parsed.get("question_navigation", False)),
        "registration": registration if isinstance(registration, dict) else {},
        "appearance": {
            "background_color": appearance.get("background_color") or DEFAULT_BACKGROUND_COLOR,
            "background_image": appearance.get("background_image") or "",
        },
    }


def inject_page_data(template: str, data: dict) -> str:
    """Put `data` into a built frontend page as window.__WEBQUIZ__ (in place of UI_DATA_MARKER)."""
    # "<" is escaped so data can never close the script tag
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return template.replace(UI_DATA_MARKER, f"<script>window.__WEBQUIZ__ = {payload};</script>")


def render_ui_page(template: Optional[str], data: dict) -> web.Response:
    """Render a built frontend page with its data injected as window.__WEBQUIZ__.

    Args:
        template: Built HTML from webquiz/ui/, or None when the frontend is not built
        data: JSON-serializable page data

    Returns:
        HTML response, or 503 with build instructions when the page is missing
    """
    if template is None:
        return web.Response(
            text="<h1>Frontend is not built</h1><p>Run <code>npm ci && npm run build</code> in <code>frontend/</code>.</p>",
            content_type="text/html",
            status=503,
        )
    return web.Response(
        text=inject_page_data(template, data), content_type="text/html", headers={"Cache-Control": "no-cache"}
    )


def get_package_version() -> str:
    """Get the webquiz package version.

    Returns:
        Package version string or "unknown" if version cannot be determined
    """
    try:
        return package_version
    except Exception as e:
        logger.exception(f"Failed to retrieve package version: {e}")
        return "unknown"


def get_file_version() -> str:
    """Read the webquiz package version directly from the __init__.py file.

    This evaluates the file to extract the __version__ variable, detecting if
    the package was updated while the server is running.

    Returns:
        Package version string from file or "unknown" if cannot be read
    """
    try:
        import importlib.resources as pkg_resources

        # Get the path to the webquiz package's __init__.py
        init_file = pkg_resources.files("webquiz") / "__init__.py"
        content = init_file.read_text(encoding="utf-8")

        # Execute the file content to extract __version__
        namespace = {}
        exec(content, namespace)

        if "__version__" in namespace:
            return namespace["__version__"]
        return "unknown"
    except Exception as e:
        logger.debug(f"Failed to read version from file: {e}")
        return "unknown"


def ensure_directory_exists(path: str) -> str:
    """Create directory if it doesn't exist and return the path.

    Args:
        path: Directory path to create

    Returns:
        The same path that was passed in
    """
    os.makedirs(path, exist_ok=True)
    return path


#: Question points may carry at most this many decimal places
POINTS_DECIMAL_PLACES = 2

#: Answers arriving this many seconds after the time limit are still accepted (slow or retried requests)
TIME_LIMIT_GRACE_SECONDS = 10

#: Grade rules used when a quiz has no ``marks``
DEFAULT_MARKS = [
    {"grade": 5, "min_score": 95},
    {"grade": 4, "min_score": 80},
    {"grade": 3, "min_score": 60},
]
DEFAULT_MARK = 2


def normalize_points(value) -> float:
    """Round a points value to POINTS_DECIMAL_PLACES, returning an int when whole.

    Points can be decimals (e.g. 0.5, 1.25), so sums of them accumulate binary
    floating point error: 0.1 + 0.2 would otherwise be reported as
    0.30000000000000004. Rounding keeps scores exact to two decimals, and whole
    values stay ints so they serialize as `3` rather than `3.0`.

    Args:
        value: A points value or a sum of them

    Returns:
        int if the rounded value is whole, otherwise float
    """
    rounded = round(float(value), POINTS_DECIMAL_PLACES)
    if rounded == int(rounded):
        return int(rounded)
    return rounded


def sum_points(values) -> float:
    """Sum points values and normalize the result.

    Args:
        values: Iterable of points values

    Returns:
        Normalized sum (int when whole, otherwise float rounded to 2 decimals)
    """
    return normalize_points(sum(values))


def get_default_config_path() -> Optional[str]:
    """Get default config file path, creating one if it doesn't exist.

    Determines the appropriate location for the config file (binary directory
    or current working directory) and creates a default config file if none exists.

    Returns:
        Path to config file or None if creation failed
    """
    # Determine where to look for/create config file
    binary_dir = os.environ.get("WEBQUIZ_BINARY_DIR")
    if binary_dir:
        config_path = Path(binary_dir) / "webquiz.yaml"
    else:
        config_path = Path.cwd() / "webquiz.yaml"

    # If config file exists, return it
    if config_path.exists():
        return str(config_path)

    # Create default config file
    try:
        create_default_config_file(config_path)
        return str(config_path)
    except Exception as e:
        logger.warning(f"Could not create default config file at {config_path}: {e}")
        return None


def create_default_config_file(config_path: Path):
    """Create a default config file with example content.

    Args:
        config_path: Path where the config file should be created

    Raises:
        Various exceptions if file cannot be written
    """
    example_content = read_package_resource("server_config.yaml.example")

    with open(config_path, "w", encoding="utf-8") as f:
        f.write(example_content)
    logger.info(f"Created default config file: {config_path}")


def load_config_with_overrides(config_path: Optional[str] = None, **cli_overrides) -> WebQuizConfig:
    """Load configuration with CLI parameter overrides.

    Priority: CLI parameters > environment variables > config file > defaults

    Args:
        config_path: Optional path to config file
        **cli_overrides: CLI parameters that override config file values

    Returns:
        WebQuizConfig object with final merged configuration
    """
    # Use default config file if none provided
    if not config_path:
        config_path = get_default_config_path()

    # Start with config file or defaults
    if config_path:
        if os.path.exists(config_path):
            config = load_config_from_yaml(config_path)
            logger.info(f"Loaded configuration from: {config_path}")
        else:
            # Config file specified but doesn't exist - create from example
            create_default_config_file(Path(config_path))
            config = load_config_from_yaml(config_path)
            logger.info(f"Loaded configuration from newly created: {config_path}")
    else:
        config = WebQuizConfig()
        logger.info("Using default configuration")

    # Apply CLI overrides
    for key, value in cli_overrides.items():
        if value is not None:  # Only override if CLI parameter was provided
            if key in ["host", "port", "url_format"]:
                setattr(config.server, key, value)
            elif key in ["quizzes_dir", "logs_dir", "csv_dir", "static_dir"]:
                setattr(config.paths, key, value)
            elif key in ["master_key"]:
                setattr(config.admin, key, value)

    # Environment variable override for master key
    env_master_key = os.environ.get("WEBQUIZ_MASTER_KEY")
    if env_master_key and not cli_overrides.get("master_key"):
        config.admin.master_key = env_master_key
        logger.info("Master key loaded from environment variable")

    # Store the actual config path that was used
    config.config_path = config_path

    return config


def log_startup_environment(config: WebQuizConfig):
    """Log important environment information at startup for troubleshooting.

    Logs system info, Python version, package versions, server configuration,
    and other useful debugging information to help diagnose issues.

    Args:
        config: WebQuizConfig object with server configuration
    """
    import sys
    import aiohttp

    logger.info("=" * 60)
    logger.info("WebQuiz Server Starting - Environment Information")
    logger.info("=" * 60)

    # WebQuiz version
    logger.info(f"WebQuiz version: {get_package_version()}")

    # Python information
    logger.info(f"Python version: {sys.version}")
    logger.info(f"Python executable: {sys.executable}")

    # Platform and OS information
    logger.info(f"Platform: {platform.platform()}")
    logger.info(f"OS: {platform.system()} {platform.release()}")
    logger.info(f"Machine: {platform.machine()}")
    logger.info(f"Processor: {platform.processor() or 'Unknown'}")

    # Key dependency versions
    logger.info(f"aiohttp version: {aiohttp.__version__}")
    try:
        import yaml as yaml_module

        logger.info(f"PyYAML version: {yaml_module.__version__}")
    except (ImportError, AttributeError):
        pass

    # Working directory and paths
    logger.info(f"Working directory: {os.getcwd()}")
    logger.info(f"Config file: {config.config_path or 'None (using defaults)'}")

    # Binary mode detection
    is_binary = os.environ.get("WEBQUIZ_IS_BINARY") == "1"
    binary_dir = os.environ.get("WEBQUIZ_BINARY_DIR")
    logger.info(f"Running as binary: {is_binary}")
    if binary_dir:
        logger.info(f"Binary directory: {binary_dir}")

    # Server configuration
    logger.info("-" * 40)
    logger.info("Server Configuration:")
    logger.info(f"  Host: {config.server.host}")
    logger.info(f"  Port: {config.server.port}")

    # Path configuration
    logger.info("Path Configuration:")
    logger.info(f"  Quizzes directory: {config.paths.quizzes_dir}")
    logger.info(f"  Logs directory: {config.paths.logs_dir}")
    logger.info(f"  CSV directory: {config.paths.csv_dir}")
    logger.info(f"  Static directory: {config.paths.static_dir}")

    # Admin configuration (without exposing master key)
    logger.info("Admin Configuration:")
    logger.info(f"  Master key set: {bool(config.admin.master_key)}")
    logger.info(f"  Trusted IPs: {config.admin.trusted_ips}")

    # Registration configuration
    logger.info("Registration Configuration:")
    logger.info(f"  Approval required: {config.registration.approve}")
    logger.info(
        f"  Username label: {config.registration.username_label or get_translations(config.language)['username_label']}"
    )
    logger.info(f"  Custom fields: {config.registration.fields}")

    # CSV configuration
    logger.info(
        f"Extra answers-with-users CSV (per-answer + user info): {config.extra_answers_with_users_csv}"
    )
    logger.info(f"Question navigation without skipping: {config.question_navigation}")

    # Tunnel configuration
    if config.tunnel.server:
        logger.info("Tunnel Configuration:")
        logger.info(f"  Server: {config.tunnel.server}")
        logger.info(f"  Public key path: {config.tunnel.public_key}")
        logger.info(f"  Private key path: {config.tunnel.private_key}")
        if config.tunnel.socket_name:
            logger.info(f"  Socket name: {config.tunnel.socket_name}")

    # Network interfaces
    try:
        interfaces = get_network_interfaces(include_ipv6=config.server.include_ipv6)
        if interfaces:
            logger.info(f"Network interfaces: {', '.join(interfaces)}")
        else:
            logger.info("Network interfaces: No non-loopback interfaces found")
    except Exception as e:
        logger.info(f"Network interfaces: Unable to retrieve ({e})")

    # Hostname
    try:
        logger.info(f"Hostname: {socket.gethostname()}")
    except Exception:
        pass

    logger.info("=" * 60)


def get_client_ip(request):
    """Extract client IP address from request, handling proxies.

    Proxy headers are trusted only when the connection itself comes from a
    loopback address: a reverse proxy on the same machine, or the SSH tunnel,
    which forwards public traffic to 127.0.0.1. A client connecting directly
    over the network cannot fake its address with headers.

    From X-Forwarded-For the LAST entry is used: a proxy appends the address
    it saw, while earlier entries may come from the client
    (e.g. nginx `$proxy_add_x_forwarded_for`).

    Args:
        request: aiohttp request object

    Returns:
        Client IP address as string, defaults to "127.0.0.1"
    """
    client_ip = request.remote or "127.0.0.1"
    if not is_loopback_address(client_ip):
        return client_ip

    forwarded_for = request.headers.get("X-Forwarded-For", "")
    forwarded_ips = [ip.strip() for ip in forwarded_for.split(",") if ip.strip()]
    if forwarded_ips:
        return forwarded_ips[-1]
    if request.headers.get("X-Real-IP", "").strip():
        return request.headers["X-Real-IP"].strip()
    return client_ip


def is_loopback_address(ip_str: str) -> bool:
    """Check if an IP address is a loopback address.

    Uses the ipaddress module to properly check the entire loopback range
    (127.0.0.0/8 for IPv4 and ::1 for IPv6).

    Args:
        ip_str: IP address string to check

    Returns:
        True if the address is loopback or invalid, False otherwise
    """
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_loopback
    except ValueError:
        # Invalid IP addresses are treated as loopback (excluded) for safety
        return True


def normalize_url(url: str) -> str:
    """Normalize URL by removing default port 80.

    Args:
        url: The URL to normalize

    Returns:
        URL with :80/ removed if present
    """
    return url.replace(":80/", "/")


def get_network_interfaces(include_ipv6=False):
    """Get all network interfaces and their IP addresses.

    Returns list of non-localhost IP addresses available on the system.
    Excludes all loopback addresses (127.0.0.0/8 and ::1).

    Args:
        include_ipv6: If True, include IPv6 addresses. Default is False.

    Returns:
        List of IP address strings (excludes loopback addresses)
    """
    interfaces = []
    # Get hostname
    hostname = socket.gethostname()

    # Get all IP addresses associated with the hostname
    ip_addresses = socket.getaddrinfo(hostname, None, socket.AF_INET)
    for ip_info in ip_addresses:
        ip = ip_info[4][0]
        if not is_loopback_address(ip):
            interfaces.append(ip)

    # Also try to get more interface info on Unix systems
    if platform.system() != "Windows":
        try:
            result = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                ips = result.stdout.strip().split()
                for ip in ips:
                    if ip not in interfaces and not is_loopback_address(ip):
                        interfaces.append(ip)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
            pass

    # Filter out IPv6 addresses if not included
    if not include_ipv6:
        interfaces = [ip for ip in interfaces if ":" not in ip]

    return list(set(interfaces))  # Remove duplicates


def admin_auth_required(func):
    """Decorator to require session cookie authentication for admin endpoints.

    Restricts access to local/private networks only.
    Bypasses authentication for requests from trusted IPs.
    Requires valid session cookie (obtained via /api/admin/auth).

    Args:
        func: Async function to wrap

    Returns:
        Wrapped function with authentication check
    """

    async def wrapper(self, request):

        # Get client IP
        client_ip = get_client_ip(request)

        # Check if IP is from local/private network
        try:
            ip_obj = ipaddress.ip_address(client_ip)
            if not ip_obj.is_private:
                return web.json_response({"error": self.translations["server_access_denied_local"]}, status=403)
        except ValueError:
            # Invalid IP format - deny access
            return web.json_response({"error": self.translations["server_access_denied_ip"]}, status=403)

        # Check if it's in trusted list (bypass authentication)
        if hasattr(self, "admin_config") and client_ip in self.admin_config.trusted_ips:
            return await func(self, request)

        # Check if master key is configured
        if not self.master_key:
            return web.json_response({"error": self._t("admin_disabled")}, status=403)

        # Check for valid session cookie
        session_token = request.cookies.get("admin_session")
        if session_token and hasattr(self, "admin_sessions") and session_token in self.admin_sessions:
            return await func(self, request)

        return web.json_response({"error": self.translations["server_invalid_session"]}, status=401)

    return wrapper


def local_network_only(func):
    """Decorator to restrict access to local/private networks only.

    Automatically detects private IP addresses (RFC 1918) and blocks public IPs.
    Private ranges: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    Also supports IPv6 private ranges (::1, fc00::/7, fe80::/10).

    Args:
        func: Async function to wrap

    Returns:
        Wrapped function with network check
    """

    async def wrapper(self, request):
        client_ip = get_client_ip(request)

        try:
            ip_obj = ipaddress.ip_address(client_ip)

            # Check if IP is private/local
            if not ip_obj.is_private:
                return web.json_response({"error": self.translations["server_access_denied_local"]}, status=403)
        except ValueError:
            # Invalid IP format - deny access
            return web.json_response({"error": self.translations["server_access_denied_ip"]}, status=403)

        return await func(self, request)

    return wrapper


#: Student API paths that check the quiz version sent by the quiz page
STUDENT_API_PATHS = (
    "/api/register",
    "/api/update-registration",
    "/api/submit-answer",
    "/api/skip-question",
    "/api/question-start",
    "/api/verify-user/",
    "/api/finish-test",
)


@web.middleware
async def error_middleware(request, handler):
    """Global error handling middleware.

    Catches all unexpected exceptions, logs them with full traceback, and returns 500 error.
    Allows HTTPException to pass through for proper HTTP status codes.

    Args:
        request: aiohttp request object
        handler: Request handler function

    Returns:
        Response from handler or formatted error response
    """
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Error handling {request.method} {request.path} from {request.remote}: {type(e).__name__}: {e}"
        )
        return web.json_response({"error": str(e)}, status=500)


class TestingServer:
    def __init__(self, config: WebQuizConfig):
        """Initialize testing server with configuration.

        Args:
            config: WebQuizConfig object with server settings
        """
        self.config = config
        self.quizzes_dir = config.paths.quizzes_dir
        self.master_key = config.admin.master_key
        self.admin_config = config.admin  # Store admin config for IP whitelist access
        self.current_quiz_file = None  # Will be set when quiz is selected
        # Changes on every quiz switch or restart; quiz pages built for another version must reload
        self.quiz_version: Optional[str] = None
        self.logs_dir = config.paths.logs_dir
        self.csv_dir = config.paths.csv_dir
        self.static_dir = config.paths.static_dir
        self.log_file = None  # Will be set during initialization
        self.csv_file = None  # Will be set when quiz is selected (answers CSV)
        self.user_csv_file = None  # Will be set when quiz is selected (users CSV)
        # Optional third CSV: per-answer rows with user_id, username and registration
        # fields prepended. Generated only when ``extra_answers_with_users_csv`` is set.
        self.answers_with_users_csv_file = None
        self.quiz_title = "Система Тестування"  # Default title, updated when quiz is loaded
        self.show_right_answer = True  # Default setting, updated when quiz is loaded
        self.show_answers_on_completion = False  # Default setting, updated when quiz is loaded
        self.show_final_list = True  # Default setting, updated when quiz is loaded
        self.time_limit_s = 0  # Seconds for the whole test, 0 = no limit (updated when quiz is loaded)
        self.allow_skip_questions = False
        self.marks = list(DEFAULT_MARKS)
        self.default_mark = DEFAULT_MARK
        self.users: Dict[str, Dict[str, Any]] = {}  # user_id -> user data
        self.questions: List[Dict[str, Any]] = []
        self.user_responses: List[Dict[str, Any]] = []
        self.user_progress: Dict[str, int] = {}  # user_id -> last_answered_question_id
        self.question_start_times: Dict[str, datetime] = {}  # user_id -> question_start_time
        self.question_start_ids: Dict[str, int] = {}  # user_id -> question the start time belongs to
        self.user_stats: Dict[str, Dict[str, Any]] = {}  # user_id -> final stats for completed users
        self.user_answers: Dict[str, List[Dict[str, Any]]] = {}  # user_id -> list of answers for stats calculation
        # user_id -> {question_id: {"selected_answer", "response"}}, answers a retried submit with the stored result
        self.answer_results: Dict[str, Dict[int, Dict[str, Any]]] = {}
        self.registration_tokens: Dict[str, str] = {}  # registration_token -> user_id, for retried registrations
        self.force_all_completed: bool = False  # Admin-triggered flag to force show answers

        # Live stats WebSocket infrastructure
        self.websocket_clients: List[web.WebSocketResponse] = []  # Connected WebSocket clients (live stats)
        self.admin_websocket_clients: List[web.WebSocketResponse] = []  # Connected admin WebSocket clients
        self.live_stats: Dict[str, Dict[int, str]] = {}  # user_id -> {question_id: state}

        # SSH Tunnel infrastructure
        self.tunnel_manager = None  # Will be initialized if tunnel is configured

        # File transfer between servers connected to the same tunnel server
        self.transfer = TransferManager(
            get_directories=lambda: {
                "quizzes": self.quizzes_dir,
                "logs": self.logs_dir,
                "csv": self.csv_dir,
                "images": os.path.join(self.quizzes_dir, "imgs"),
                "attachments": os.path.join(self.quizzes_dir, "attach"),
            },
            get_endpoint=lambda: self.tunnel_manager.get_public_endpoint() if self.tunnel_manager else None,
            notify=self.broadcast_to_admin_websockets,
            get_files_in_use=lambda: [
                self.log_file,
                self.csv_file,
                self.user_csv_file,
                self.answers_with_users_csv_file,
                self.current_quiz_file,
            ],
            get_language=lambda: self.config.language,
        )

        # Admin session storage for cookie-based authentication
        self.admin_sessions: Dict[str, datetime] = {}  # session_token -> creation_time

        # Load translations based on language config
        self.translations = get_translations(config.language)

        # Preload templates
        self.templates = self._load_templates()

    def _t(self, key: str, **params) -> str:
        """Admin API message in the configured language (see ADMIN_TRANSLATIONS)."""
        return admin_text(self.config.language, key, **params)

    def _load_templates(self) -> Dict[str, str]:
        """Preload all templates at startup.

        Returns:
            Dictionary mapping template filenames to their content
        """
        templates = {}
        template_files = [
            "quiz_selection_required.html",
            "template_error.html",
        ]

        for template_file in template_files:
            try:
                templates[template_file] = read_package_resource(f"templates/{template_file}")
                logger.info(f"Loaded template: {template_file}")
            except Exception as e:
                logger.warning(f"Failed to load template {template_file}: {e}")

        for page in UI_PAGES:
            try:
                templates[f"ui/{page}"] = (UI_DIR / page).read_text(encoding="utf-8")
                logger.info(f"Loaded UI page: {page}")
            except OSError as e:
                logger.warning(f"Failed to load UI page {page} (run `npm run build` in frontend/): {e}")

        return templates

    def _ui_page_data(self, page: Optional[dict] = None) -> dict:
        """Data a built frontend page receives as window.__WEBQUIZ__ (`page` holds the page's own data)."""
        data = {"language": self.config.language, "version": package_version}
        if page is not None:
            data["page"] = page
        return data

    def generate_log_path(self) -> str:
        """Generate log file path in logs directory with simple numeric naming.

        Finds the next available number (0001, 0002, etc.) for the log file.

        Returns:
            Path to the new log file
        """
        ensure_directory_exists(self.logs_dir)

        # Find the next available number
        suffix = 1
        while True:
            log_path = os.path.join(self.logs_dir, f"{suffix:04d}.log")
            if not os.path.exists(log_path):
                return log_path
            suffix += 1

    def generate_csv_path(self, quiz_name: str, csv_type: str = "answers") -> str:
        """Generate CSV file path in CSV directory with quiz name and numeric naming.

        Ensures all three CSV types use the same numeric suffix.

        Args:
            quiz_name: Name of the quiz file
            csv_type: Type of CSV - 'answers', 'users', or 'answers_with_users'

        Returns:
            Path to CSV file:
              - answers:             quiz_0001.csv
              - users:               quiz_0001.users.csv
              - answers_with_users:  quiz_0001.answers_with_users.csv
        """
        ensure_directory_exists(self.csv_dir)

        # Clean quiz name (remove extension and replace path separators)
        quiz_prefix = quiz_name.replace(".yaml", "").replace(".yml", "")
        quiz_prefix = quiz_prefix.replace("/", "_").replace("\\", "_")

        # Find the next available number for this quiz
        suffix = 1
        while True:
            answers_csv = os.path.join(self.csv_dir, f"{quiz_prefix}_{suffix:04d}.csv")
            users_csv = os.path.join(self.csv_dir, f"{quiz_prefix}_{suffix:04d}.users.csv")
            answers_with_users_csv = os.path.join(
                self.csv_dir, f"{quiz_prefix}_{suffix:04d}.answers_with_users.csv"
            )

            if csv_type == "users":
                csv_path = users_csv
            elif csv_type == "answers_with_users":
                csv_path = answers_with_users_csv
            else:  # answers
                csv_path = answers_csv

            # Use the same numeric suffix across all three file types
            if (
                not os.path.exists(answers_csv)
                and not os.path.exists(users_csv)
                and not os.path.exists(answers_with_users_csv)
            ):
                return csv_path
            suffix += 1

    def reset_server_state(self):
        """Reset all server state for new quiz.

        Clears users, responses, progress, stats, and live stats data.
        """
        self.users.clear()
        self.user_responses.clear()
        self.user_progress.clear()
        self.question_start_times.clear()
        self.question_start_ids.clear()
        self.user_stats.clear()
        self.user_answers.clear()
        self.answer_results.clear()
        self.registration_tokens.clear()
        self.live_stats.clear()
        self.force_all_completed = False
        logger.info("Server state reset for new quiz")

    def reload_config_from_file(self) -> Optional[WebQuizConfig]:
        """Reload configuration from file.

        Returns:
            New WebQuizConfig if successful, None if failed or no config path
        """
        if not self.config.config_path:
            return None
        return load_config_from_yaml(self.config.config_path)

    def _config_requires_restart(self, new_config: WebQuizConfig, raw_config: dict = None) -> List[str]:
        """Check which config changes require server restart.

        Only checks sections that were explicitly specified in the raw config.
        If a section is missing from raw_config, the user didn't change it.

        Args:
            new_config: New configuration to compare against current
            raw_config: Raw parsed YAML data to check which sections were specified

        Returns:
            List of config paths that require restart (empty if none)
        """
        restart_reasons = []
        raw_config = raw_config or {}

        # Check server config (only if server section was specified)
        if "server" in raw_config:
            server_data = raw_config.get("server", {})
            if "host" in server_data and self.config.server.host != new_config.server.host:
                restart_reasons.append("server.host")
            if "port" in server_data and self.config.server.port != new_config.server.port:
                restart_reasons.append("server.port")

        # Check paths (only if paths section was specified)
        if "paths" in raw_config:
            paths_data = raw_config.get("paths", {})
            if "quizzes_dir" in paths_data and self.quizzes_dir != new_config.paths.quizzes_dir:
                restart_reasons.append("paths.quizzes_dir")
            if "logs_dir" in paths_data and self.logs_dir != new_config.paths.logs_dir:
                restart_reasons.append("paths.logs_dir")
            if "csv_dir" in paths_data and self.csv_dir != new_config.paths.csv_dir:
                restart_reasons.append("paths.csv_dir")
            if "static_dir" in paths_data and self.static_dir != new_config.paths.static_dir:
                restart_reasons.append("paths.static_dir")

        # Check master_key (only if admin.master_key was specified)
        if "admin" in raw_config:
            admin_data = raw_config.get("admin", {})
            if "master_key" in admin_data and self.master_key != new_config.admin.master_key:
                restart_reasons.append("admin.master_key")

        return restart_reasons

    async def apply_config_changes(self, new_config: WebQuizConfig):
        """Apply hot-reloadable config changes to running server.

        Updates registration, admin.trusted_ips, quizzes, tunnel config.
        Reloads templates. Disconnects tunnel if connected (admin can reconnect).
        Does NOT change server, paths, or master_key.

        Args:
            new_config: New configuration loaded from file
        """
        # Update language and translations
        self.config.language = new_config.language
        self.translations = get_translations(new_config.language)

        # Update extra_answers_with_users_csv flag (takes effect on next quiz switch / quiz restart)
        self.config.extra_answers_with_users_csv = new_config.extra_answers_with_users_csv

        # Question navigation on the quiz page (the quiz restart after a config save regenerates the page)
        self.config.question_navigation = new_config.question_navigation

        # Update registration config
        self.config.registration = new_config.registration

        # Update the quiz page background (the quiz restart after a config save regenerates the page)
        self.config.appearance = new_config.appearance

        # Update admin.trusted_ips only (keep master_key unchanged)
        self.config.admin.trusted_ips = new_config.admin.trusted_ips

        # Update downloadable quizzes list
        self.config.quizzes = new_config.quizzes

        # Update tunnel config and disconnect if connected
        self.config.tunnel = new_config.tunnel
        if self.tunnel_manager:
            # Update tunnel manager's config reference
            self.tunnel_manager.config = new_config.tunnel
            # Disconnect if connected (admin can reconnect with new config)
            if self.tunnel_manager.status.get("connected"):
                logger.info("Disconnecting tunnel due to config change")
                await self.tunnel_manager.disconnect()

        # Reload templates (in case package was updated)
        self.templates = self._load_templates()

        logger.info("Configuration changes applied to running server")

    async def restart_current_quiz(self):
        """Restart currently running quiz, resetting all state.

        Reloads quiz file, regenerates index.html, notifies clients.
        Does nothing if no quiz is currently active.
        """
        if not self.current_quiz_file or not os.path.exists(self.current_quiz_file):
            return

        quiz_filename = self._current_quiz_name()
        try:
            await self.switch_quiz(quiz_filename)
            logger.info(f"Quiz restarted after config change: {quiz_filename}")
        except Exception as e:
            logger.error(f"Failed to restart quiz after config change: {e}")

    def _resolve_quiz_path(self, filename):
        """Return the absolute path of a quiz file, or None when the name is not a quiz inside quizzes_dir.

        Quizzes may live in subfolders, so the name is a relative path ("grade5/math.yaml");
        backslashes are accepted as separators.
        """
        if not filename or not isinstance(filename, str):
            return None
        name = filename.replace("\\", "/")
        if not name.endswith((".yaml", ".yml")) or name.startswith("/") or os.path.isabs(name):
            return None
        base = os.path.realpath(self.quizzes_dir)
        path = os.path.realpath(os.path.join(base, *name.split("/")))
        if os.path.commonpath([base, path]) != base or path == base:
            return None
        return path

    @staticmethod
    def _with_quiz_extension(filename):
        """Append .yaml unless the name already ends with .yaml or .yml."""
        return filename if filename.endswith((".yaml", ".yml")) else filename + ".yaml"

    @staticmethod
    def _ensure_parent_dir(path):
        """Create the folder a new quiz file goes into (quizzes may live in subfolders)."""
        os.makedirs(os.path.dirname(path), exist_ok=True)

    def _quiz_relative_name(self, path):
        """Return the quiz name relative to quizzes_dir with forward slashes."""
        return Path(os.path.relpath(path, self.quizzes_dir)).as_posix()

    def _current_quiz_name(self):
        """Return the active quiz name relative to quizzes_dir (forward slashes), or None."""
        return self._quiz_relative_name(self.current_quiz_file) if self.current_quiz_file else None

    def _is_current_quiz(self, filename):
        path = self._resolve_quiz_path(filename)
        return bool(self.current_quiz_file and path) and os.path.realpath(self.current_quiz_file) == path

    @staticmethod
    def _quiz_list_entry(quizzes_path: Path, quiz_path: Path) -> dict:
        """One quiz of the admin list: name, title and the settings shown next to it (None when unreadable)."""
        info = {"filename": quiz_path.relative_to(quizzes_path).as_posix(), "title": None}
        try:
            with open(quiz_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception:
            return info
        if not isinstance(data, dict):
            return info
        questions = data.get("questions")
        questions = [q for q in questions if isinstance(q, dict)] if isinstance(questions, list) else []
        try:
            total_points = sum_points(q.get("points", 1) for q in questions)
        except (TypeError, ValueError):
            total_points = None
        time_limit = data.get("time_limit", 0)
        info.update(
            {
                "title": data.get("title"),
                "total_questions": len(questions),
                "total_points": total_points,
                "time_limit": time_limit if isinstance(time_limit, (int, float)) and not isinstance(time_limit, bool) else 0,
                "randomize_questions": bool(data.get("randomize_questions", False)),
                "allow_skip_questions": bool(data.get("allow_skip_questions", False)),
                "show_right_answer": bool(data.get("show_right_answer", True)),
                "show_answers_on_completion": bool(data.get("show_answers_on_completion", False)),
                "show_final_list": bool(data.get("show_final_list", True)),
            }
        )
        return info

    async def list_available_quizzes(self):
        """List all available quiz files in quizzes directory (subfolders included) with titles and settings.

        Returns:
            List of dicts (see _quiz_list_entry) sorted by filename
        """
        quiz_files = {}
        quizzes_path = Path(self.quizzes_dir)
        if quizzes_path.exists():
            for pattern in ("*.yaml", "*.yml"):
                for quiz_path in quizzes_path.rglob(pattern):
                    if "imgs" in quiz_path.parts or "attach" in quiz_path.parts:
                        continue
                    filename = quiz_path.relative_to(quizzes_path).as_posix()
                    if filename not in quiz_files:
                        quiz_files[filename] = self._quiz_list_entry(quizzes_path, quiz_path)
        return sorted(quiz_files.values(), key=lambda x: x["filename"])

    async def switch_quiz(self, quiz_filename: str):
        """Switch to a different quiz file and reset server state.

        Resets all user data, loads new questions, regenerates index.html,
        and notifies connected WebSocket clients.

        Args:
            quiz_filename: Name of the quiz file to switch to

        Raises:
            ValueError: If quiz file doesn't exist
        """
        resolved_path = self._resolve_quiz_path(quiz_filename)
        if not resolved_path or not os.path.exists(resolved_path):
            raise ValueError(f"Quiz file not found: {quiz_filename}")
        quiz_filename = self._quiz_relative_name(resolved_path)
        quiz_path = os.path.join(self.quizzes_dir, *quiz_filename.split("/"))

        # Reset server state
        self.reset_server_state()
        self.quiz_version = secrets.token_hex(8)

        # Update current quiz and CSV filenames (answers, users, optional extra)
        self.current_quiz_file = quiz_path
        self.csv_file = self.generate_csv_path(quiz_filename, "answers")
        self.user_csv_file = self.generate_csv_path(quiz_filename, "users")
        if self.config.extra_answers_with_users_csv:
            self.answers_with_users_csv_file = self.generate_csv_path(quiz_filename, "answers_with_users")
        else:
            self.answers_with_users_csv_file = None

        # Load new questions
        await self.load_questions_from_file(quiz_path)

        # Regenerate index.html with new questions
        await self.create_default_index_html()

        img_path = Path(f"{self.static_dir}/img")
        copy_resource("img/top-left.png", img_path)
        copy_resource("img/top-right.png", img_path)

        # Notify WebSocket clients about quiz switch
        await self.broadcast_to_websockets(
            {
                "type": "quiz_switched",
                "current_quiz": quiz_filename,
                "quiz_version": self.quiz_version,
                "questions": self.questions,
                "total_questions": len(self.questions),
                "message": self._t("quiz_switched", name=quiz_filename),
            }
        )
        # Users were cleared, so the admin page must drop its list of users waiting for approval
        await self.broadcast_to_admin_websockets(
            {
                "type": "quiz_switched",
                "current_quiz": quiz_filename,
                "pending_users": {},
                "requires_approval": hasattr(self.config, "registration") and self.config.registration.approve,
                "quiz": self._admin_quiz_info(),
                "users": [],
            }
        )

        logger.info(f"Switched to quiz: {quiz_filename}, CSV: {self.csv_file}")

    async def create_admin_selection_page(self):
        """Create a page informing admin to select a quiz first.

        Displays list of available quizzes and instructs admin to use
        the admin panel to select one.
        """
        ensure_directory_exists(self.static_dir)
        index_path = f"{self.static_dir}/index.html"

        # Get list of available quizzes for display
        available_quizzes = await self.list_available_quizzes()
        quiz_list_html = ""
        for quiz in available_quizzes:
            if quiz["title"]:
                quiz_list_html += f"<li>{quiz['filename']} - {quiz['title']}</li>"
            else:
                quiz_list_html += f"<li>{quiz['filename']}</li>"

        # Load template and replace placeholders
        template_content = self.templates.get("quiz_selection_required.html", "")
        selection_html = template_content.replace("{{QUIZ_LIST}}", quiz_list_html)

        async with aiofiles.open(index_path, "w", encoding="utf-8") as f:
            await f.write(selection_html)
        logger.info(f"Created admin selection page: {index_path}")

    async def initialize_log_file(self):
        """Initialize new log file with unique suffix in logs directory.

        Creates the log file and logs initial server start message.
        """

        # Generate log file path
        self.log_file = self.generate_log_path()
        # Create the new log file
        with open(self.log_file, "w", encoding="utf-8") as f:
            f.write("")
        logger.info(f"=== Server Started - New Log File Created: {self.log_file} ===")

    async def initialize_tunnel(self):
        """Initialize SSH tunnel if configured.

        Checks if tunnel is configured, validates/generates keys, but does not
        auto-connect. Connection is initiated by admin via button click.
        """
        if not self.config.tunnel.server:
            logger.info("SSH tunnel not configured, skipping initialization")
            return

        logger.info(f"Initializing SSH tunnel for server: {self.config.tunnel.server}")

        # Create tunnel manager
        self.tunnel_manager = TunnelManager(
            self.config.tunnel, local_port=self.config.server.port, get_language=lambda: self.config.language
        )

        # Set up status callback to broadcast changes to admin clients
        async def tunnel_status_callback(status):
            # Include configured and server fields in status updates
            tunnel_update = {
                "configured": True,
                "server": self.config.tunnel.server,
                "socket_name": self.config.tunnel.socket_name,
                **status,
            }
            await self.broadcast_to_admin_websockets({"type": "tunnel_status", "tunnel": tunnel_update})

        self.tunnel_manager.set_status_callback(tunnel_status_callback)

        # Ensure keys exist (generate if needed), but don't connect yet
        success, message = await self.tunnel_manager.ensure_keys_exist()

        if success:
            logger.info(f"SSH tunnel initialized successfully: {message}")
        else:
            logger.warning(f"SSH tunnel keys not ready: {message}")

    async def create_default_config_yaml(self, file_path: str = None):
        """Create default quiz YAML file with example questions.

        Args:
            file_path: Path where the file should be created (optional)
        """
        if file_path is None:
            file_path = self.config_file if hasattr(self, "config_file") else "config.yaml"
        default_questions = {
            "title": "Тестовий Quiz",
            "show_right_answer": False,
            "show_answers_on_completion": True,
            "randomize_questions": False,
            "time_limit": 300,
            "allow_skip_questions": False,
            "marks": [
                {"grade": 5, "min_score": 95},
                {"grade": 4, "min_score": 80},
                {"grade": 3, "min_score": 60},
            ],
            "questions": [
                {
                    "question": "Скільки буде 2 + 2?",
                    "options": ["3", "4", "5", "6"],
                    "correct_answer": 1,
                },
                {
                    "question": "Яка столиця України?",
                    "options": ["Харків", "Львів", "Київ", "Одеса"],
                    "correct_answer": 2,
                },
            ],
        }

        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(yaml.dump(default_questions, default_flow_style=False, allow_unicode=True))
        logger.info(f"Created default config file: {file_path}")

    async def load_questions_from_file(self, quiz_file_path: str):
        """Load questions from specific quiz file for quiz execution.

        Loads questions, title, settings, and adds automatic IDs.

        Args:
            quiz_file_path: Path to the quiz YAML file

        Raises:
            Various exceptions if file cannot be read or parsed
        """
        async with aiofiles.open(quiz_file_path, "r", encoding="utf-8") as f:
            content = await f.read()
            data = yaml.safe_load(content)
            self.questions = data["questions"]

            # Store quiz title or use default
            self.quiz_title = data.get("title", "Система Тестування")

            # Store show_right_answer setting (default: True)
            self.show_right_answer = data.get("show_right_answer", True)

            # Store randomize_questions setting (default: False)
            self.randomize_questions = data.get("randomize_questions", False)

            # Store show_answers_on_completion setting (default: False)
            self.show_answers_on_completion = data.get("show_answers_on_completion", False)

            self.time_limit_s = data.get("time_limit", 0)
            self.allow_skip_questions = data.get("allow_skip_questions", False)

            marks_data = data.get("marks") or DEFAULT_MARKS
            self.marks = sorted(
                [
                    m
                    for m in marks_data
                    if isinstance(m, dict)
                    and "grade" in m
                    and isinstance(m.get("min_score"), (int, float))
                    and not isinstance(m.get("min_score"), bool)
                ],
                key=lambda x: x["min_score"],
                reverse=True,
            )
            # Grade when no rule matches (below the lowest min_score)
            self.default_mark = data.get("default_mark", DEFAULT_MARK)

            # Store show_final_list setting (default: True)
            self.show_final_list = data.get("show_final_list", True)

            # Add automatic IDs based on array index (for quiz execution only)
            for i, question in enumerate(self.questions):
                question["id"] = i + 1

            logger.info(
                f"Loaded {len(self.questions)} questions from {quiz_file_path}, "
                f"show_right_answer: {self.show_right_answer}, randomize_questions: {self.randomize_questions}, "
                f"show_answers_on_completion: {self.show_answers_on_completion}, "
                f"time_limit: {self.time_limit_s}, "
                f"show_final_list: {self.show_final_list}"
            )

    async def load_questions(self):
        """Load questions based on available quiz files.

        Handles multiple scenarios:
        - No quiz files: creates default.yaml
        - Single quiz file: uses it automatically
        - Multiple files with default.yaml: uses default.yaml
        - Multiple files without default.yaml: requires admin selection
        """
        # Check if quizzes directory exists
        if not os.path.exists(self.quizzes_dir):
            os.makedirs(self.quizzes_dir)
            logger.info(f"Created quizzes directory: {self.quizzes_dir}")

        # Get available quiz files
        available_quizzes = await self.list_available_quizzes()
        quiz_filenames = [q["filename"] for q in available_quizzes]

        if not available_quizzes:
            # No quiz files found, create default
            default_path = os.path.join(self.quizzes_dir, "default.yaml")
            await self.create_default_config_yaml(default_path)
            await self.switch_quiz("default.yaml")
        elif len(available_quizzes) == 1:
            # Only one quiz file - use it as default
            await self.switch_quiz(quiz_filenames[0])
            logger.info(f"Using single quiz file as default: {quiz_filenames[0]}")
        elif "default.yaml" in quiz_filenames or "default.yml" in quiz_filenames:
            # Multiple files but default.yaml exists - use it
            default_file = "default.yaml" if "default.yaml" in quiz_filenames else "default.yml"
            await self.switch_quiz(default_file)
            logger.info(f"Using explicit default file: {default_file}")
        else:
            # Multiple files but no default.yaml - don't load any quiz
            logger.info(f"Multiple quiz files found but no default.yaml - admin must select quiz first")
            await self.create_admin_selection_page()

    async def create_default_index_html(self):
        """Create default index.html file with embedded questions data.

        Embeds questions (without correct answers), registration fields,
        quiz title, and settings into the HTML template.
        """
        ensure_directory_exists(self.static_dir)
        index_path = f"{self.static_dir}/index.html"

        # Prepare questions data for client (without correct answers)
        questions_for_client = []
        for q in self.questions:
            # Check if this is a text input question (has checker)
            is_text_question = "checker" in q

            if is_text_question:
                # Text input question - no options, no correct_answer
                client_question = {
                    "id": q["id"],
                    "type": "text",
                    "default_value": q.get("default_value", ""),
                    "points": normalize_points(q.get("points", 1)),
                }
            else:
                # Choice question
                client_question = {
                    "id": q["id"],
                    "options": q["options"],
                    "is_multiple_choice": isinstance(q["correct_answer"], list),
                    "points": normalize_points(q.get("points", 1)),  # Default 1 point per question
                }
                # Include min_correct for multiple choice questions
                if isinstance(q["correct_answer"], list):
                    client_question["min_correct"] = q.get("min_correct", len(q["correct_answer"]))

            # Include question text if present
            if "question" in q and q["question"]:
                client_question["question"] = q["question"]
            # Include optional image attribute if present
            if "image" in q and q["image"]:
                client_question["image"] = q["image"]
            # Include optional file attribute if present (prepend /attach/ if not already there)
            if "file" in q and q["file"]:
                file_path = q["file"]
                if not file_path.startswith("/attach/"):
                    file_path = f"/attach/{file_path}"
                client_question["file"] = file_path

            questions_for_client.append(client_question)

        # Username label from config; falls back to the translation when not customized
        username_label = self.translations["username_label"]
        if hasattr(self.config, "registration") and getattr(self.config.registration, "username_label", None):
            username_label = self.config.registration.username_label

        registration_fields = []
        if hasattr(self.config, "registration") and self.config.registration.fields:
            registration_fields = [
                {"label": label, "name": label.lower().replace(" ", "_")} for label in self.config.registration.fields
            ]

        page = {
            "title": self.quiz_title,
            "quizVersion": self.quiz_version or "",
            "questions": questions_for_client,
            "showRightAnswer": self.show_right_answer,
            "showFinalList": self.show_final_list,
            "questionNavigation": self.config.question_navigation,
            "usernameLabel": username_label,
            "registrationFields": registration_fields,
            "translations": self.translations,
            "background": {
                "color": self.config.appearance.background_color,
                "image": self.config.appearance.background_image,
            },
        }

        template = self.templates.get("ui/quiz.html")
        if template is None:
            html_content = "<h1>Frontend is not built</h1><p>Run <code>npm ci && npm run build</code> in <code>frontend/</code>.</p>"
        else:
            html_content = inject_page_data(template, self._ui_page_data(page))
            html_content = html_content.replace("<title>WebQuiz</title>", f"<title>{html.escape(self.quiz_title)}</title>")
            # Relative asset URLs: the quiz page may be served under a reverse proxy prefix (server.url_format)
            html_content = html_content.replace('="/ui/', '="ui/')

        # Write to destination
        async with aiofiles.open(index_path, "w", encoding="utf-8") as f:
            await f.write(html_content)

    async def flush_responses_to_csv(self):
        """Flush in-memory responses to CSV file.

        Writes accumulated responses to CSV, creating file with headers if needed.
        Clears in-memory responses after writing.

        When ``extra_answers_with_users_csv`` is enabled, the same rows are also
        appended to a third CSV that prepends user info (user_id, username,
        registration fields) to each per-answer row.
        """
        if not self.user_responses:
            return

        # Check if CSV file exists, if not create it with headers
        file_exists = os.path.exists(self.csv_file)

        # Use StringIO buffer to write CSV data
        csv_buffer = StringIO()
        csv_writer = csv.writer(csv_buffer, lineterminator="\n")

        # Write headers if file doesn't exist
        if not file_exists:
            csv_writer.writerow(
                ["ПІБ", "Питання", "Відповідь", "Правильна відповідь", "Результат", "Витрачено часу"]
            )

        # Write all responses to buffer
        for response in self.user_responses:
            user_data = self.users[response["user_id"]]
            username = user_data["username"]
            result = "Вірно" if response['is_correct'] == True else "Помилка"
            total_time_formatted = self.format_seconds_to_hms(int(response["time_taken_seconds"]))
            csv_writer.writerow(
                [
                    username,
                    response["question"],
                    response["selected_answer"],
                    response["correct_answer"],
                    result,
                    total_time_formatted,
                ]
            )

        # Snapshot responses for the answers_with_users CSV before clearing
        responses_snapshot = list(self.user_responses) if self.answers_with_users_csv_file else None

        # Write buffer content to file
        csv_content = csv_buffer.getvalue()
        csv_buffer.close()
        total_responses = len(self.user_responses)
        self.user_responses.clear()

        mode = "w" if not file_exists else "a"
        # newline="" keeps the csv writer's line endings (no \r\n translation on Windows)
        async with aiofiles.open(self.csv_file, mode, encoding="utf-8", newline="") as f:
            await f.write(csv_content)
            await f.flush()
            os.fsync(f.fileno())

        action = "Created" if not file_exists else "Updated"
        logger.info(f"{action} CSV file with {total_responses} responses: {self.csv_file}")

        # Also write the answers_with_users CSV (per-answer rows enriched with user info)
        if self.answers_with_users_csv_file and responses_snapshot:
            await self._append_answers_with_users_csv(responses_snapshot)

    async def _append_answers_with_users_csv(self, responses):
        """Append per-answer rows enriched with user info to the answers_with_users CSV.

        Headers (written once when the file is first created):
            user_id, username, [registration_fields...], question,
            selected_answer, correct_answer, is_correct, time_taken_seconds

        Args:
            responses: List of response dicts (as stored in ``self.user_responses``)
        """
        if not responses:
            return

        registration_fields = []
        if hasattr(self.config, "registration") and self.config.registration.fields:
            registration_fields = list(self.config.registration.fields)

        file_exists = os.path.exists(self.answers_with_users_csv_file)

        csv_buffer = StringIO()
        csv_writer = csv.writer(csv_buffer)

        if not file_exists:
            headers = ["user_id", "username"]
            for field_label in registration_fields:
                headers.append(field_label.lower().replace(" ", "_"))
            headers.extend(
                ["question", "selected_answer", "correct_answer", "is_correct", "time_taken_seconds"]
            )
            csv_writer.writerow(headers)

        for response in responses:
            user_id = response["user_id"]
            user_data = self.users.get(user_id, {})
            row = [user_id, user_data.get("username", response.get("username", ""))]
            for field_label in registration_fields:
                field_name = field_label.lower().replace(" ", "_")
                row.append(user_data.get(field_name, ""))
            row.extend(
                [
                    response["question"],
                    response["selected_answer"],
                    response["correct_answer"],
                    response["is_correct"],
                    response["time_taken_seconds"],
                ]
            )
            csv_writer.writerow(row)

        csv_content = csv_buffer.getvalue()
        csv_buffer.close()

        mode = "w" if not file_exists else "a"
        async with aiofiles.open(self.answers_with_users_csv_file, mode, encoding="utf-8", newline="") as f:
            await f.write(csv_content)
            await f.flush()
            os.fsync(f.fileno())

        action = "Created" if not file_exists else "Updated"
        logger.info(
            f"{action} answers_with_users CSV file with {len(responses)} rows: "
            f"{self.answers_with_users_csv_file}"
        )

    async def flush_users_to_csv(self):
        """Flush user registration data to separate CSV file.

        Writes all user data including statistics to CSV, always overwriting
        the file with current data.
        """
        if not self.users or not self.user_csv_file:
            return

        # Use StringIO buffer to write CSV data
        csv_buffer = StringIO()
        csv_writer = csv.writer(csv_buffer, lineterminator="\n")

        # Determine headers based on registration fields
        headers = ["№", "ПІБ"]
        if hasattr(self.config, "registration") and self.config.registration.fields:
            for field_label in self.config.registration.fields:
                field_name = field_label.replace(" ", "_")
                headers.append(field_name)

        headers.extend(
            ["Оцінка", "Витрачено часу", "Дано відповідей", "Правильні відповіді", "Всього питань", "Старт тесту", "Завершення тесту"]
        )

        # Always write headers (we always overwrite the file)
        csv_writer.writerow(headers)

        # Write all user data to buffer
        i = 1
        for user_id, user_data in self.users.items():
            row = [i, user_data["username"]]
            i = i + 1

            # Add additional registration fields in order
            if hasattr(self.config, "registration") and self.config.registration.fields:
                for field_label in self.config.registration.fields:
                    field_name = field_label.lower().replace(" ", "_")
                    row.append(user_data.get(field_name, ""))

            # Calculate and add user statistics
            user_answer_list = self.user_answers.get(user_id, [])
            # time_taken == -1 indicates a placeholder answer generated after the quiz timeout
            answers_given = len([a for a in user_answer_list if a["time_taken"] != -1])
            correct_answers = sum(answer["is_correct"] for answer in user_answer_list)
            total_points = sum_points(q.get("points", 1) for q in self.questions)
            earned_points = sum_points(
                answer.get("earned_points", 1 if answer["is_correct"] else 0) for answer in user_answer_list
            )
            percentage = round((earned_points / total_points) * 100) if total_points > 0 else 0
            mark = self.get_mark(percentage)
            start_dt = user_data.get("quiz_start_time")
            end_dt = user_data.get("quiz_finish_time")

            if start_dt and end_dt:
                total_time_seconds = int((end_dt - start_dt).total_seconds())
            else:
                total_time_seconds = 0
            time_start = start_dt.strftime("%d.%m.%Y %H:%M:%S") if start_dt else ""
            time_end = end_dt.strftime("%d.%m.%Y %H:%M:%S") if end_dt else ""
            # Format total_time as HH:MM:SS
            total_time_formatted = self.format_seconds_to_hms(total_time_seconds)
            row.extend([mark, total_time_formatted, answers_given, correct_answers, len(self.questions), time_start, time_end])

            csv_writer.writerow(row)

        # Write buffer content to file
        csv_content = csv_buffer.getvalue()
        csv_buffer.close()

        # Always overwrite the file (users don't accumulate like responses do)
        async with aiofiles.open(self.user_csv_file, "w", encoding="utf-8", newline="") as f:
            await f.write(csv_content)
            await f.flush()
            os.fsync(f.fileno())

    def format_seconds_to_hms(self, seconds):
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        seconds = seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    async def periodic_flush(self):
        """Periodically flush responses and users to CSV every 5 seconds."""
        while True:
            await asyncio.sleep(5)  # Flush every 30 seconds
            try:
                await self.flush_responses_to_csv()
            except Exception as e:
                logger.exception(f"Error during flush_responses_to_csv: {e}")

            try:
                await self.flush_users_to_csv()
            except Exception as e:
                logger.exception(f"Error during flush_users_to_csv: {e}")

    async def _broadcast_to_websocket_list(
        self, clients_list: List[web.WebSocketResponse], message: dict, client_type: str = "WebSocket"
    ):
        """Generic broadcast function for WebSocket clients.

        Sends message to all connected clients and removes closed connections.

        Args:
            clients_list: List of WebSocket client connections
            message: Dictionary to send as JSON
            client_type: Description of client type for logging

        Returns:
            List of active clients (closed connections removed)
        """
        if not clients_list:
            return []

        # Clean up closed connections and broadcast
        active_clients = []
        for ws in clients_list:
            if not ws.closed:
                try:
                    await ws.send_str(json.dumps(message))
                    active_clients.append(ws)
                except Exception as e:
                    logger.warning(f"Failed to send message to {client_type} client: {e}")

        return active_clients

    async def broadcast_to_websockets(self, message: dict):
        """Broadcast message to all connected WebSocket clients (live stats).

        Args:
            message: Dictionary to send as JSON
        """
        self.websocket_clients = await self._broadcast_to_websocket_list(
            self.websocket_clients, message, "live stats WebSocket"
        )
        # Every live stats change concerns one user; the admin overview gets that user's full record
        if message.get("user_id"):
            await self.notify_admin_user_updated(message["user_id"])

    async def broadcast_to_admin_websockets(self, message: dict):
        """Broadcast message to all connected admin WebSocket clients.

        Args:
            message: Dictionary to send as JSON
        """
        self.admin_websocket_clients = await self._broadcast_to_websocket_list(
            self.admin_websocket_clients, message, "admin WebSocket"
        )

    def _extract_registration_fields(self, user_data: dict) -> dict:
        """Extract only custom registration fields for display to admin.

        Excludes system fields: user_id, username, approved, registered_at, question_order.
        Returns only the custom fields configured in registration.fields.

        Args:
            user_data: User data dictionary

        Returns:
            Dictionary with only custom registration fields
        """
        fields = {}
        if hasattr(self.config, "registration") and self.config.registration.fields:
            for field_label in self.config.registration.fields:
                field_name = field_label.lower().replace(" ", "_")
                if field_name in user_data:
                    fields[field_name] = user_data[field_name]
        return fields

    def _admin_quiz_info(self) -> dict:
        """Current quiz summary for the admin overview page."""
        return {
            "filename": self._current_quiz_name(),
            "title": getattr(self, "quiz_title", None),
            "total_questions": len(self.questions),
            "total_points": sum_points(q.get("points", 1) for q in self.questions),
            "time_limit": getattr(self, "time_limit_s", 0) or 0,
            "randomize_questions": bool(getattr(self, "randomize_questions", False)),
            "allow_skip_questions": bool(getattr(self, "allow_skip_questions", False)),
            "show_answers_on_completion": bool(getattr(self, "show_answers_on_completion", False)),
            "force_all_completed": self.force_all_completed,
            "requires_approval": hasattr(self.config, "registration") and self.config.registration.approve,
            "questions": [
                {
                    "id": q["id"],
                    "question": q.get("question", ""),
                    "image": q.get("image"),
                    "points": normalize_points(q.get("points", 1)),
                    "correct_answer": self._answer_parts(
                        q.get("correct_value", "") if "checker" in q else q.get("correct_answer"), q
                    ),
                }
                for q in self.questions
            ],
        }

    def _answer_parts(self, answer, question) -> list:
        """Answer as a list of texts for the admin page: the typed text or the chosen options (image paths stay paths)."""
        if "checker" in question or isinstance(answer, str):
            return [str(answer)]
        options = question.get("options") or []
        indices = sorted(answer) if isinstance(answer, list) else [answer]
        return [options[i] if isinstance(i, int) and 0 <= i < len(options) else str(i) for i in indices]

    def _admin_user_record(self, user_id: str) -> dict:
        """Everything the admin overview shows about one user: status, progress, points, grade, timing."""
        user_data = self.users[user_id]
        answers = self.user_answers.get(user_id, [])
        # time_taken == -1 marks a placeholder for a question left unanswered when the test was finished
        given = [a for a in answers if a.get("time_taken") != -1]
        stats = self.user_stats.get(user_id)
        approved = user_data.get("approved", True)

        if not approved:
            status = "pending"
        elif stats is not None:
            status = "time_up" if user_data.get("finish_reason") == "timeout" else "completed"
        else:
            status = "in_progress"

        start = user_data.get("quiz_start_time")
        finish = user_data.get("quiz_finish_time")
        elapsed = int(((finish or datetime.now()) - start).total_seconds()) if start else None

        questions = {q["id"]: q for q in self.questions}
        given_answers = {
            str(question_id): self._answer_parts(result["selected_answer"], questions[question_id])
            for question_id, result in self.answer_results.get(user_id, {}).items()
            if question_id in questions
        }

        return {
            "user_id": user_id,
            "username": user_data["username"],
            "registration_fields": self._extract_registration_fields(user_data),
            "status": status,
            "registered_at": user_data.get("registered_at"),
            "answered": len(given),
            "correct": sum(1 for a in given if a.get("is_correct")),
            "skipped": len(user_data.get("skipped_questions", [])),
            "earned_points": sum_points(a.get("earned_points", 0) for a in answers),
            "mark": stats["mark"] if stats else None,
            "points_percentage": stats["points_percentage"] if stats else None,
            "elapsed_seconds": elapsed,
            "remaining_seconds": self._remaining_seconds(user_data) if status == "in_progress" else None,
            "question_order": user_data.get("question_order") or [q["id"] for q in self.questions],
            "live_stats": self.live_stats.get(user_id, {}),
            "answers": given_answers,
        }

    async def notify_admin_user_updated(self, user_id: str):
        """Send the user's current record to the admin pages."""
        if user_id in self.users and self.admin_websocket_clients:
            await self.broadcast_to_admin_websockets({"type": "user_updated", "user": self._admin_user_record(user_id)})

    def _validate_answer(self, selected_answer, question):
        """Validate answer for single choice, multiple choice, and text input questions.

        For single answer: checks if selected index matches correct index.
        For multiple answers: validates all selected are correct, no incorrect
        selected, and minimum correct requirement is met.
        For text input: executes the checker code with the user's answer.

        Args:
            selected_answer: Integer index, list of integer indices, or string (for text input)
            question: Question dictionary with options and correct_answer (or checker for text)

        Returns:
            For choice questions: True if answer is correct, False otherwise
            For text questions: tuple (is_correct: bool, error_message: str or None)
        """
        # Handle text input questions (has checker)
        if "checker" in question:
            return self._execute_checker(selected_answer, question)

        correct_answer = question["correct_answer"]

        if isinstance(correct_answer, int):
            # Single answer question
            return selected_answer == correct_answer
        elif isinstance(correct_answer, list):
            # Multiple answer question
            if not isinstance(selected_answer, list):
                return False

            # Convert to sets for comparison
            selected_set = set(selected_answer)
            correct_set = set(correct_answer)

            # Check if any incorrect answers were selected
            if not selected_set.issubset(set(range(len(question["options"])))):
                return False  # Invalid option indices

            # Check if any incorrect answers were selected
            incorrect_selected = selected_set - correct_set
            if incorrect_selected:
                return False  # Any incorrect answer makes it wrong

            # Check minimum correct requirement
            min_correct = question.get("min_correct", len(correct_answer))
            correct_selected = selected_set & correct_set

            return len(correct_selected) >= min_correct
        else:
            return False  # Invalid correct_answer format

    def _execute_checker(self, user_answer, question):
        """Execute checker code to validate a text input answer.

        The checker code is executed in a restricted environment with limited
        builtins and access to the user's answer via the 'user_answer' variable.

        Args:
            user_answer: The user's text answer string
            question: Question dictionary with 'checker' code

        Returns:
            tuple: (is_correct: bool, error_message: str or None)
                   is_correct is True if checker runs without exceptions
                   error_message contains the exception message if validation failed
        """
        checker_code = question.get("checker", "")
        if not checker_code:
            # No checker code - consider correct if answer matches correct_value
            correct_value = question.get("correct_value", "")
            return (user_answer.strip() == correct_value.strip(), None)

        import math

        # Define restricted builtins for safe execution
        safe_builtins = {
            "abs": abs,
            "all": all,
            "any": any,
            "bool": bool,
            "chr": chr,
            "dict": dict,
            "enumerate": enumerate,
            "filter": filter,
            "float": float,
            "format": format,
            "frozenset": frozenset,
            "int": int,
            "isinstance": isinstance,
            "len": len,
            "list": list,
            "map": map,
            "max": max,
            "min": min,
            "ord": ord,
            "pow": pow,
            "range": range,
            "repr": repr,
            "reversed": reversed,
            "round": round,
            "set": set,
            "slice": slice,
            "sorted": sorted,
            "str": str,
            "sum": sum,
            "tuple": tuple,
            "type": type,
            "zip": zip,
            "math": math,
            "__import__": None,  # Disable imports
            # Checker helper functions
            **{fname: getattr(checker_module, fname) for fname in checker_module.__all__},
        }
        exec_globals = {"__builtins__": safe_builtins}
        exec_locals = {"user_answer": user_answer}

        try:
            # Execute the checker code
            exec(checker_code, exec_globals, exec_locals)
            # If no exception was raised, the answer is correct
            return (True, None)
        except Exception as e:
            return (False, str(e))

    def _format_answer_text(self, answer_indices, options, is_text_question=False):
        """Format answer text for CSV with | separator for multiple answers.

        Args:
            answer_indices: Integer index, list of integer indices, or string (for text input)
            options: List of option strings (None for text questions)
            is_text_question: True if this is a text input question

        Returns:
            Formatted answer string (single option or pipe-separated options)
        """
        # Handle text input questions
        if is_text_question or isinstance(answer_indices, str):
            return str(answer_indices)

        if isinstance(answer_indices, int):
            # Validate index bounds
            if options and 0 <= answer_indices < len(options):
                return options[answer_indices]
            else:
                logger.warning(
                    f"Invalid answer index {answer_indices} for options with length {len(options) if options else 0}"
                )
                return f"Invalid index: {answer_indices}"
        elif isinstance(answer_indices, list):
            # Sort indices and join corresponding option texts with |
            sorted_indices = sorted(answer_indices)
            valid_options = []
            for idx in sorted_indices:
                if options and 0 <= idx < len(options):
                    valid_options.append(options[idx])
                else:
                    logger.warning(
                        f"Invalid answer index {idx} in list for options with length {len(options) if options else 0}"
                    )
                    valid_options.append(f"Invalid index: {idx}")
            return "|".join(valid_options)
        else:
            return str(answer_indices)

    def generate_random_question_order(self) -> list:
        """Generate a random question order for a user.

        Returns a list of question IDs in random order, respecting stick_to_the_previous
        groupings. Questions with stick_to_the_previous: true stay adjacent to their
        predecessor, and groups are shuffled as units.

        Algorithm:
        1. Build groups by iterating through questions - non-sticky questions start
           new groups, sticky questions join previous group
        2. Shuffle the groups (not individual questions)
        3. Flatten groups back to a single question order list

        Only called if self.randomize_questions is True.

        Returns:
            List of question IDs in shuffled order
        """
        import random

        # Build groups respecting stick_to_the_previous
        groups = []
        current_group = []

        for question in self.questions:
            question_id = question["id"]
            is_sticky = question.get("stick_to_the_previous", False)

            if is_sticky and current_group:
                # Add to current group
                current_group.append(question_id)
            else:
                # Start new group (also handles first question or non-sticky)
                if current_group:
                    groups.append(current_group)
                current_group = [question_id]

        # Don't forget the last group
        if current_group:
            groups.append(current_group)

        # Shuffle groups
        random.shuffle(groups)

        # Flatten to final order
        shuffled_ids = []
        for group in groups:
            shuffled_ids.extend(group)

        logger.info(f"Generated random question order with sticky groups: {shuffled_ids}")
        return shuffled_ids

    def update_live_stats(self, user_id: str, question_id: int, state: str, time_taken: float = None):
        """Update live stats for a user and question.

        Args:
            user_id: User identifier
            question_id: Question identifier
            state: State string ("think", "ok", "fail", "skip")
            time_taken: Optional time taken in seconds
        """
        if user_id not in self.live_stats:
            self.live_stats[user_id] = {}

        # Store both state and time_taken
        self.live_stats[user_id][question_id] = {"state": state, "time_taken": time_taken}

    async def register_user(self, request):
        """Register a new user.

        Creates user account with unique ID, validates username uniqueness,
        handles approval workflow, and generates random question order if enabled.

        Args:
            request: aiohttp request with username and registration fields

        Returns:
            JSON response with user_id and registration status
        """
        data = await request.json()
        username = data["username"].strip()

        # The quiz page sends a random token with each registration and repeats the request
        # when the connection drops. If the first attempt got through, return that user.
        registration_token = data.get("registration_token")
        if not isinstance(registration_token, str) or not registration_token:
            registration_token = None
        if registration_token and self.registration_tokens.get(registration_token) in self.users:
            user_id = self.registration_tokens[registration_token]
            logger.info(f"Repeated registration for user {user_id}, returning the existing user")
            return web.json_response(self._registration_response(user_id))

        if not username:
            return web.json_response({"error": self.translations["server_username_empty"]}, status=400)

        # Check if username already exists
        for existing_user in self.users.values():
            if existing_user["username"] == username:
                return web.json_response({"error": self.translations["server_username_exists"]}, status=400)

        # Generate unique 6-digit user ID
        max_attempts = 100
        for _ in range(max_attempts):
            user_id = str(random.randint(100000, 999999))
            if user_id not in self.users:
                break
        else:
            return web.json_response({"error": self.translations["server_user_id_generation_failed"]}, status=500)

        # Check if approval is required
        requires_approval = hasattr(self.config, "registration") and self.config.registration.approve

        # Build user data with additional registration fields
        user_data = {
            "user_id": user_id,
            "username": username,
            "registered_at": datetime.now().isoformat(),
            "approved": not requires_approval,  # Auto-approve if approval not required
            "skipped_questions": [],
            "time_limit": self.time_limit_s,
            "allow_skip_questions": self.allow_skip_questions
        }

        # Add additional registration fields if configured
        if hasattr(self.config, "registration") and self.config.registration.fields:
            for field_label in self.config.registration.fields:
                # Convert field label to field name (lowercase, sanitized)
                field_name = field_label.lower().replace(" ", "_")
                # Get value from request data
                field_value = data.get(field_name, "").strip()
                if not field_value:
                    return web.json_response({"error": self.translations["server_field_empty"].format(field=field_label)}, status=400)
                user_data[field_name] = field_value

        # Generate random question order if randomization is enabled
        if self.randomize_questions:
            user_data["question_order"] = self.generate_random_question_order()
            logger.info(f"Generated random question order for user {user_id}: {user_data['question_order']}")

        self.users[user_id] = user_data
        if registration_token:
            self.registration_tokens[registration_token] = user_id

        # If approval not required, start timing and live stats immediately
        if not requires_approval:
            # Start timing for first question
            self.question_start_times[user_id] = datetime.now()
            self.question_start_ids[user_id] = self._first_question_id(user_data)
            user_data["quiz_start_time"] = datetime.now()

            # Initialize live stats: set first question to "think"
            if len(self.questions) > 0:
                # Determine first question ID (use question_order if randomization enabled)
                first_question_id = user_data.get("question_order", [1])[0] if self.randomize_questions else 1

                self.update_live_stats(user_id, first_question_id, "think")

                # Broadcast new user registration to live stats
                await self.broadcast_to_websockets(
                    {
                        "type": "user_registered",
                        "user_id": user_id,
                        "username": username,
                        "question_id": first_question_id,
                        "state": "think",
                        "time_taken": None,
                        "total_questions": len(self.questions),
                        "total_points": sum_points(q.get("points", 1) for q in self.questions),
                    }
                )
        else:
            # Broadcast to admin WebSocket for approval
            await self.broadcast_to_admin_websockets(
                {
                    "type": "new_registration",
                    "user_id": user_data["user_id"],
                    "username": user_data["username"],
                    "registration_fields": self._extract_registration_fields(user_data),
                }
            )
            await self.notify_admin_user_updated(user_id)

        logger.info(f"Registered user: {username} with ID: {user_id}, requires_approval: {requires_approval}")

        return web.json_response(self._registration_response(user_id))

    def _registration_response(self, user_id):
        """Build the register response for a registered user.

        Args:
            user_id: User identifier

        Returns:
            Dictionary with user_id, username, approval status and question order
        """
        user_data = self.users[user_id]
        requires_approval = hasattr(self.config, "registration") and self.config.registration.approve
        response_data = {
            "username": user_data["username"],
            "user_id": user_id,
            "message": "User registered successfully",
            "requires_approval": requires_approval,
            "approved": user_data["approved"],
            "time_limit": self.time_limit_s,
            "allow_skip_questions": self.allow_skip_questions,
            "quiz_start_time": datetime.now().isoformat()
        }

        # Include question_order if randomization is enabled
        if self.randomize_questions and "question_order" in user_data:
            response_data["question_order"] = user_data["question_order"]

        return response_data

    async def update_registration(self, request):
        """Update registration data for a user (only if not approved yet).

        Args:
            request: aiohttp request with user_id and fields to update

        Returns:
            JSON response with success status and updated user data
        """
        data = await request.json()
        user_id = data.get("user_id")

        if not user_id:
            return web.json_response({"error": self._t("user_id_required")}, status=400)

        # Check if user exists
        if user_id not in self.users:
            return web.json_response({"error": self.translations["server_update_not_found"]}, status=404)

        user_data = self.users[user_id]

        # Check if user is already approved
        if user_data.get("approved", False):
            return web.json_response({"error": self.translations["server_update_after_approval"]}, status=400)

        # Update username if provided
        username = data.get("username", "").strip()
        if username:
            # Check if new username already exists (exclude current user)
            for existing_user_id, existing_user in self.users.items():
                if existing_user_id != user_id and existing_user["username"] == username:
                    return web.json_response({"error": self.translations["server_username_exists"]}, status=400)
            user_data["username"] = username

        # Update additional registration fields if configured
        if hasattr(self.config, "registration") and self.config.registration.fields:
            for field_label in self.config.registration.fields:
                # Convert field label to field name (lowercase, sanitized)
                field_name = field_label.lower().replace(" ", "_")
                # Get value from request data
                field_value = data.get(field_name, "").strip()
                if field_value:  # Only update if provided
                    user_data[field_name] = field_value

        # Update user data in memory
        self.users[user_id] = user_data

        # Broadcast update to admin WebSocket
        await self.broadcast_to_admin_websockets(
            {
                "type": "registration_updated",
                "user_id": user_id,
                "username": user_data["username"],
                "registration_fields": self._extract_registration_fields(user_data),
            }
        )
        await self.notify_admin_user_updated(user_id)

        logger.info(f"Updated registration data for user: {user_id}")
        return web.json_response(
            {"success": True, "message": "Registration data updated successfully", "user_data": user_data}
        )

    async def skip_question(self, request):
        """Skip test answer.

        Validates answer, calculates time taken, stores response, updates progress,
        broadcasts to WebSocket clients, and calculates final stats if test complete.

        Args:
            request: aiohttp request with user_id and question_id

        Returns:
            JSON response with feedback (conditionally includes correctness)
        """

        if not self.allow_skip_questions:
            return web.json_response({"error": self.translations["server_skip_forbidden"]}, status=403)

        data = await request.json()
        user_id = data["user_id"]
        question_id = data["question_id"]

        # Find user by user_id
        if user_id not in self.users:
            return web.json_response({"error": self.translations["server_user_not_found"]}, status=404)

        username = self.users[user_id]["username"]
        user_data = self.users[user_id]

        # Find the question
        question = next((q for q in self.questions if q["id"] == question_id), None)
        if not question:
            return web.json_response({"error": self.translations["server_question_not_found"]}, status=404)

        if self._time_is_up(user_data):
            await self._finish_user_test(user_id, "timeout")
            return web.json_response({"error": self.translations["time_is_up"], "time_is_up": True}, status=409)

        if any(answer.get("question_id") == question_id for answer in self.user_answers.get(user_id, [])):
            return web.json_response({"error": self.translations["server_already_answered"]}, status=409)

        # Calculate time taken server-side from when question was displayed
        time_taken = self._take_question_time(user_id, question_id)

        if question_id not in user_data.setdefault("skipped_questions", []):
            user_data["skipped_questions"].append(question_id)

        # Update user progress
        self.user_progress[user_id] = question_id

        # Update live stats: set current question state based on correctness
        state = "skip"
        self.update_live_stats(user_id, question_id, state, time_taken)

        # Broadcast current question result with completion status
        await self.broadcast_to_websockets(
            {
                "type": "state_update",
                "user_id": user_id,
                "username": username,
                "question_id": question_id,
                "state": state,
                "time_taken": time_taken,
                "total_questions": len(self.questions),
                "total_points": sum_points(q.get("points", 1) for q in self.questions),
                "earned_points": 0,
                "question_points": 0,
                "completed": False,
                "completed_at": None,
            }
        )

        logger.info(
            f"Answer skipped by {username} (ID: {user_id}) for question {question_id}: (took {time_taken}s)"
        )
        logger.info(f"Updated progress for user {user_id}: last answered question = {question_id}")

        # Prepare response data
        response_data = {"time_taken": time_taken, "message": "Answer skipped successfully"}

        return web.json_response(response_data)

    async def submit_answer(self, request):
        """Submit test answer.

        Validates answer, calculates time taken, stores response, updates progress,
        broadcasts to WebSocket clients, and calculates final stats if test complete.

        Args:
            request: aiohttp request with user_id, question_id, and selected_answer

        Returns:
            JSON response with feedback (conditionally includes correctness)
        """
        data = await request.json()
        user_id = data["user_id"]
        question_id = data["question_id"]
        selected_answer = data["selected_answer"]

        # Find user by user_id
        if user_id not in self.users:
            return web.json_response({"error": self.translations["server_user_not_found"]}, status=404)

        username = self.users[user_id]["username"]
        user_data = self.users[user_id]

        # The quiz page repeats the request when the connection drops. If the first attempt
        # got through and only the response was lost, return the stored result.
        previous_result = self.answer_results.get(user_id, {}).get(question_id)
        if previous_result is not None and previous_result["selected_answer"] == selected_answer:
            logger.info(f"Repeated answer from user {user_id} for question {question_id}, returning stored result")
            return web.json_response(previous_result["response"])

        # Questions may be answered in any order (navigation and skipping), but only once.
        # This also covers placeholders added by finish_test for unanswered questions.
        already_answered = previous_result is not None or any(
            answer.get("question_id") == question_id for answer in self.user_answers.get(user_id, [])
        )
        if already_answered:
            return web.json_response({"error": self.translations["server_already_answered"]}, status=409)

        if self._time_is_up(user_data):
            await self._finish_user_test(user_id, "timeout")
            return web.json_response({"error": self.translations["time_is_up"], "time_is_up": True}, status=409)

        # Find the question
        question = next((q for q in self.questions if q["id"] == question_id), None)
        if not question:
            return web.json_response({"error": self.translations["server_question_not_found"]}, status=404)

        # Calculate time taken server-side from when question was displayed
        time_taken = self._take_question_time(user_id, question_id)

        # Check if this is a text input question (has checker)
        is_text_question = "checker" in question
        checker_error = None

        # Check if answer is correct (handle single, multiple, and text answers)
        validation_result = self._validate_answer(selected_answer, question)

        # Handle text question result (returns tuple)
        if is_text_question:
            is_correct, checker_error = validation_result
        else:
            is_correct = validation_result

        # Determine the correct answer text for storage
        if is_text_question:
            correct_answer_text = question.get("correct_value", "")
            selected_answer_text = str(selected_answer)
        else:
            correct_answer_text = self._format_answer_text(question["correct_answer"], question.get("options"))
            selected_answer_text = self._format_answer_text(selected_answer, question.get("options"))

        # Store response in memory
        response_data = {
            "user_id": user_id,
            "username": username,
            "question_id": question_id,
            "question": question.get("question", ""),  # Handle image-only questions
            "selected_answer": selected_answer_text,
            "correct_answer": correct_answer_text,
            "is_correct": is_correct,
            "time_taken_seconds": time_taken,
            "timestamp": datetime.now().isoformat(),
        }

        # Add checker error for text questions if present
        if is_text_question and checker_error:
            response_data["checker_error"] = checker_error

        self.user_responses.append(response_data)

        # Track answer separately for stats calculation (independent of CSV flushing)
        if user_id not in self.user_answers:
            self.user_answers[user_id] = []

        # Normalize file path for results (prepend /attach/ if needed)
        file_value = question.get("file")
        if file_value and not file_value.startswith("/attach/"):
            file_value = f"/attach/{file_value}"

        # Get points for this question (default: 1, may be a decimal)
        question_points = normalize_points(question.get("points", 1))
        earned_points = question_points if is_correct else 0

        answer_data = {
            "question": question.get("question", ""),  # Handle image-only questions
            "question_id": question.get("id"),
            "image": question.get("image"),
            "file": file_value,
            "selected_answer": selected_answer_text,
            "correct_answer": correct_answer_text,
            "is_correct": is_correct,
            "time_taken": time_taken,
            "points": question_points,  # Points for this question
            "earned_points": earned_points,  # Points actually earned
        }

        # Add checker error for text questions if present
        if is_text_question and checker_error:
            answer_data["checker_error"] = checker_error

        self.user_answers[user_id].append(answer_data)

        # Update user progress
        self.user_progress[user_id] = question_id

        # Update live stats: set current question state based on correctness
        state = "ok" if is_correct else "fail"
        self.update_live_stats(user_id, question_id, state, time_taken)

        # Check if this was the last question and calculate final stats
        # Use the number of answers instead of question_id to support randomization
        test_completed = len(self.user_answers.get(user_id, [])) == len(self.questions)
        completion_time = None
        if test_completed:
            user_data["quiz_finish_time"] = datetime.now()
            # Test completed - calculate and store final stats
            self.calculate_and_store_user_stats(user_id)
            # Get completion time from stored stats
            completion_time = self.user_stats.get(user_id, {}).get("completed_at").strftime("%d.%m.%Y %H:%M:%S")
            logger.info(f"Test completed for user {user_id} - final stats calculated")

        # Prepare response data
        response_data = {"time_taken": time_taken, "message": "Answer submitted successfully"}

        # Only include correctness feedback and correct answer if show_right_answer is enabled
        if self.show_right_answer:
            response_data["is_correct"] = is_correct

            if is_text_question:
                # Text input question response
                response_data["is_text_question"] = True
                response_data["correct_value"] = question.get("correct_value", "")
                if checker_error:
                    response_data["checker_error"] = checker_error
            else:
                # Choice question response
                response_data["correct_answer"] = question["correct_answer"]
                response_data["is_multiple_choice"] = isinstance(question["correct_answer"], list)

        # Stored before the broadcast below awaits, so a retry arriving meanwhile gets this result
        self.answer_results.setdefault(user_id, {})[question_id] = {
            "selected_answer": selected_answer,
            "response": response_data,
        }

        # Broadcast current question result with completion status
        await self.broadcast_to_websockets(
            {
                "type": "state_update",
                "user_id": user_id,
                "username": username,
                "question_id": question_id,
                "state": state,
                "time_taken": time_taken,
                "total_questions": len(self.questions),
                "total_points": sum_points(q.get("points", 1) for q in self.questions),
                "earned_points": earned_points,
                "question_points": question_points,
                "completed": test_completed,
                "completed_at": completion_time,
            }
        )

        logger.info(
            f"Answer submitted by {username} (ID: {user_id}) for question {question_id}: {'Correct' if is_correct else 'Incorrect'} (took {time_taken}s)"
        )
        logger.info(f"Updated progress for user {user_id}: last answered question = {question_id}")

        return web.json_response(response_data)

    async def finish_test(self, request):
        """Finish test attempt.

        Finalizes the test session for a user: unanswered questions get wrong placeholder
        answers, final stats are calculated and the completion is broadcast to live stats.
        A test that is already completed is left unchanged, so a late or repeated request
        does not move the finish time.

        Args:
            request: aiohttp request with user_id and optional finish reason
                     (e.g. "timeout", "manual", "forced")

        Returns:
            JSON response with success status
        """
        data = await request.json()
        user_id = data.get("user_id")
        reason = data.get("reason", "manual")

        logger.info(f"Test is finished for user_id {user_id}, reason: {reason}")

        # Find user by user_id
        if user_id not in self.users:
            return web.json_response({"error": self.translations["server_user_not_found"]}, status=404)

        if not self.users[user_id].get("quiz_start_time"):
            return web.json_response({"error": self.translations["server_test_not_started"]}, status=400)

        await self._finish_user_test(user_id, reason)
        return web.json_response({"status": "success"})

    def _first_question_id(self, user_data):
        """Return the id of the first question the user sees (respects randomization)."""
        if self.randomize_questions and user_data.get("question_order"):
            return user_data["question_order"][0]
        return self.questions[0]["id"] if self.questions else None

    def _take_question_time(self, user_id, question_id):
        """Return seconds spent on the question and stop its timing.

        The start time only counts when it belongs to this question: with navigation the
        student may have moved to another question since.
        """
        start = self.question_start_times.pop(user_id, None)
        started_question_id = self.question_start_ids.pop(user_id, None)
        if start is None or (started_question_id is not None and started_question_id != question_id):
            return 0
        return (datetime.now() - start).total_seconds()

    def _test_deadline(self, user_data):
        """Return the moment the user's time runs out, or None without a time limit."""
        time_limit = user_data.get("time_limit", self.time_limit_s)
        start = user_data.get("quiz_start_time")
        if not time_limit or not start:
            return None
        return start + timedelta(seconds=time_limit)

    def _remaining_seconds(self, user_data):
        """Return whole seconds left for the user, or None without a time limit."""
        deadline = self._test_deadline(user_data)
        if deadline is None:
            return None
        return max(0, math.ceil((deadline - datetime.now()).total_seconds()))

    def _time_is_up(self, user_data):
        """True when the time limit has passed, allowing TIME_LIMIT_GRACE_SECONDS for slow requests."""
        deadline = self._test_deadline(user_data)
        return deadline is not None and datetime.now() > deadline + timedelta(seconds=TIME_LIMIT_GRACE_SECONDS)

    def _is_test_completed(self, user_id):
        return len(self.user_answers.get(user_id, [])) >= len(self.questions)

    async def _finish_user_test(self, user_id, reason):
        """Complete the user's test: add wrong placeholder answers for unanswered questions.

        Does nothing when the test is already completed.
        """
        user_data = self.users[user_id]
        if self._is_test_completed(user_id) and user_id in self.user_stats:
            logger.info(f"Test for user {user_id} is already completed, finish request ({reason}) ignored")
            return

        user_data["finish_reason"] = reason
        deadline = self._test_deadline(user_data)
        if reason == "timeout" and deadline is not None:
            user_data["quiz_finish_time"] = min(datetime.now(), deadline)
        else:
            user_data["quiz_finish_time"] = datetime.now()

        username = user_data["username"]
        user_answer_list = self.user_answers.setdefault(user_id, [])
        answered_ids = {answer.get("question_id") for answer in user_answer_list}

        for question in self.questions:
            if question["id"] in answered_ids:
                continue

            # Normalize file path for results (prepend /attach/ if needed)
            file_value = question.get("file")
            if file_value and not file_value.startswith("/attach/"):
                file_value = f"/attach/{file_value}"

            is_text_question = "checker" in question
            if is_text_question:
                correct_answer_text = question.get("correct_value", "")
            else:
                correct_answer_text = self._format_answer_text(question["correct_answer"], question.get("options"))

            # time_taken == -1 marks a placeholder for a question the student did not answer
            user_answer_list.append(
                {
                    "question": question.get("question", ""),  # Handle image-only questions
                    "question_id": question["id"],
                    "image": question.get("image"),
                    "file": file_value,
                    "selected_answer": "",
                    "correct_answer": correct_answer_text,
                    "is_correct": False,
                    "time_taken": -1,
                    "points": normalize_points(question.get("points", 1)),
                    "earned_points": 0,
                }
            )

            self.update_live_stats(user_id, question["id"], "fail", 0)

            await self.broadcast_to_websockets(
                {
                    "type": "state_update",
                    "user_id": user_id,
                    "username": username,
                    "question_id": question["id"],
                    "state": "fail",
                    "time_taken": 0,
                    "total_questions": len(self.questions),
                    "total_points": sum_points(q.get("points", 1) for q in self.questions),
                    "earned_points": 0,
                    "question_points": normalize_points(question.get("points", 1)),
                    "completed": True,
                    "completed_at": user_data["quiz_finish_time"].strftime("%d.%m.%Y %H:%M:%S"),
                }
            )

        self.question_start_times.pop(user_id, None)
        self.question_start_ids.pop(user_id, None)

        # Test completed - calculate and store final stats
        self.calculate_and_store_user_stats(user_id)
        logger.info(f"Test completed for user {user_id} ({reason}) - final stats calculated")
        await self.notify_admin_user_updated(user_id)

    async def question_start(self, request):
        """Handle notification that a user started viewing a question.

        Starts timing for the question and updates live stats to "think" state.

        Args:
            request: aiohttp request with user_id and question_id

        Returns:
            JSON response with success status
        """
        data = await request.json()
        user_id = data["user_id"]
        question_id = data["question_id"]

        # Verify user exists
        if user_id not in self.users:
            return web.json_response({"error": self.translations["server_user_not_found"]}, status=404)

        username = self.users[user_id]["username"]

        # A repeated notice that arrives after the answer must not start timing again
        if question_id in self.answer_results.get(user_id, {}):
            return web.json_response({"status": "success"})

        # Navigation can move to another question before answering: timing follows the shown question.
        # A repeated notice for the same question keeps the original start time.
        if user_id not in self.question_start_times or self.question_start_ids.get(user_id) != question_id:
            self.question_start_times[user_id] = datetime.now()
            self.question_start_ids[user_id] = question_id
        self.update_live_stats(user_id, question_id, "think")

        # Get points for current question
        question = next((q for q in self.questions if q["id"] == question_id), None)
        question_points = normalize_points(question.get("points", 1)) if question else 1

        await self.broadcast_to_websockets(
            {
                "type": "state_update",
                "user_id": user_id,
                "username": username,
                "question_id": question_id,
                "state": "think",
                "time_taken": None,
                "total_questions": len(self.questions),
                "total_points": sum_points(q.get("points", 1) for q in self.questions),
                "question_points": question_points,
            }
        )

        return web.json_response({"status": "success"})

    def get_mark(self, percentage):
        """Convert a score percentage into a grade using the quiz ``marks`` rules.

        Rules are sorted by ``min_score`` descending; when none matches, ``default_mark`` is used.
        """
        for rule in self.marks:
            if percentage >= rule["min_score"]:
                return rule["grade"]
        return self.default_mark

    def calculate_and_store_user_stats(self, user_id):
        """Calculate and store final stats for a completed user.

        Uses user_answers tracking (independent of CSV flushing) to calculate
        correct count, percentage, points, and total time.

        Args:
            user_id: User identifier
        """
        # Get answers from dedicated user_answers tracking (independent of CSV flushing)
        if user_id not in self.user_answers or not self.user_answers[user_id]:
            logger.warning(f"No answers found for user {user_id} during stats calculation")
            return

        user_data = self.users[user_id]
        if getattr(self, "randomize_questions", False) and "question_order" in user_data:
            question_order = user_data["question_order"]
        else:
            question_order = [q["id"] for q in self.questions]

        question_position = {}

        for idx, qid in enumerate(question_order):
            question_position[qid] = idx

        user_answer_list = self.user_answers[user_id]

        sorted_answers = sorted(
            user_answer_list,
            key=lambda a: question_position.get(a["question_id"], float("inf"))
        )

        # Calculate stats from user_answers
        correct_count = 0
        total_time = 0
        earned_points = 0
        total_points = 0

        for answer in sorted_answers:
            if answer["is_correct"]:
                correct_count += 1
            if answer["time_taken"] > 0:
                total_time += answer["time_taken"]
            earned_points += answer.get("earned_points", 1 if answer["is_correct"] else 0)
            total_points += answer.get("points", 1)

        # Points can be decimals, so round the running sums back to 2 decimals
        earned_points = normalize_points(earned_points)
        total_points = normalize_points(total_points)

        total_count = len(sorted_answers)
        percentage = round((correct_count / total_count) * 100) if total_count > 0 else 0
        points_percentage = round((earned_points / total_points) * 100) if total_points > 0 else 0

        # time_taken == -1 indicates a placeholder answer generated after the quiz timeout
        given_answers_count = len([a for a in sorted_answers if a["time_taken"] != -1])

        # The grade follows the points percentage, which equals the plain percentage when all points are 1
        mark = self.get_mark(points_percentage)

        # Store final stats (copy the answer data to avoid reference issues)
        self.user_stats[user_id] = {
            "test_results": [answer.copy() for answer in sorted_answers],
            "correct_count": correct_count,
            "total_count": given_answers_count,
            "percentage": percentage,
            "mark": mark,
            "earned_points": earned_points,
            "total_points": total_points,
            "points_percentage": points_percentage,
            "total_time": total_time,
            "completed_at": user_data["quiz_finish_time"],
        }

        logger.info(
            f"Stored final stats for user {user_id}: {correct_count}/{total_count} ({percentage}%), "
            f"points: {earned_points}/{total_points} ({points_percentage}%) using user_answers"
        )

    def all_students_completed(self):
        """Check if all students have completed the quiz.

        Counts only approved students when approval is required.
        Dynamically evaluates based on current state.
        Can be forced to True by admin for manual answer revelation.

        Returns:
            bool: True if all students have completed, False otherwise
        """
        # If admin manually marked as completed, return True immediately
        if self.force_all_completed:
            return True

        # Get count of approved students (or all students if approval not required)
        requires_approval = hasattr(self.config, "registration") and self.config.registration.approve

        if requires_approval:
            # Count only approved students
            approved_count = sum(1 for user_data in self.users.values() if user_data.get("approved", False))
            total_students = approved_count
        else:
            # Count all registered students
            total_students = len(self.users)

        # Count completed students
        completed_count = len(self.user_stats)

        # Return True if all students have completed
        # Handle edge case: if no students registered, return False
        if total_students == 0:
            return False

        return completed_count >= total_students

    def get_user_final_results(self, user_id):
        """Get final results for a completed user from persistent user_stats.

        Filters out correct answer information based on configuration:
        - If show_right_answer is True: always show correct answers
        - If show_answers_on_completion is True and all students completed: show correct answers
        - Otherwise: hide correct answers

        Args:
            user_id: User identifier

        Returns:
            Dictionary with test_results, correct_count, total_count, percentage, total_time,
            all_completed, and show_answers_on_completion flags
        """
        if user_id in self.user_stats:
            # Return stored stats (without the completed_at timestamp for the frontend)
            stats = self.user_stats[user_id].copy()
            stats.pop("completed_at", None)  # Remove timestamp from response

            # Check if all students have completed
            all_completed = self.all_students_completed()

            # Add flags for frontend
            stats["all_completed"] = all_completed
            stats["show_answers_on_completion"] = self.show_answers_on_completion

            # Determine if correct answers should be shown
            # Priority: show_right_answer > show_answers_on_completion
            should_show_answers = self.show_right_answer or (self.show_answers_on_completion and all_completed)

            # If answers should not be shown, remove correct answer information from test results
            if not should_show_answers:
                # Create a copy of test_results without correct_answer and is_correct fields
                modified_results = []
                for result in stats.get("test_results", []):
                    result_copy = result.copy()
                    result_copy.pop("correct_answer", None)  # Remove correct_answer field
                    result_copy.pop("is_correct", None)  # Remove is_correct field
                    modified_results.append(result_copy)
                stats["test_results"] = modified_results

            return stats

        # Fallback - should not happen if calculate_and_store_user_stats was called
        return {
            "test_results": [],
            "correct_count": 0,
            "total_count": 0,
            "percentage": 0,
            "earned_points": 0,
            "total_points": 0,
            "points_percentage": 0,
            "total_time": 0,
            "all_completed": False,
            "show_answers_on_completion": False,
        }

    async def verify_user_id(self, request):
        """Verify if user_id exists and return user data.

        Returns user approval status, test progress, and final results if completed.

        Args:
            request: aiohttp request with user_id in path

        Returns:
            JSON response with user validation data and test state
        """
        user_id = request.match_info["user_id"]

        # Find user by user_id
        if user_id not in self.users:
            return web.json_response({"valid": False, "message": "User ID not found"})

        user_data = self.users[user_id]
        username = user_data["username"]
        approved = user_data.get("approved", True)  # Default to True for backwards compatibility

        # Check if approval is required and user is not yet approved
        requires_approval = hasattr(self.config, "registration") and self.config.registration.approve
        if requires_approval and not approved:
            # User waiting for approval
            response_data = {
                "valid": True,
                "user_id": user_id,
                "username": username,
                "approved": False,
                "requires_approval": True,
                "user_data": user_data,
                "message": "User waiting for approval",
            }

            # Include question_order if randomization is enabled
            if self.randomize_questions and "question_order" in user_data:
                response_data["question_order"] = user_data["question_order"]

            return web.json_response(response_data)

        # User is approved (or approval not required), return test state
        # Get last answered question ID from progress tracking
        last_answered_question_id = self.user_progress.get(user_id, 0)

        # Find the index of next question to answer
        next_question_index = 0
        if last_answered_question_id > 0:
            if self.randomize_questions and "question_order" in user_data:
                # With randomization: find index in user's custom order
                try:
                    last_index = user_data["question_order"].index(last_answered_question_id)
                    next_question_index = last_index + 1
                except ValueError:
                    # Question ID not found in order (shouldn't happen), default to 0
                    next_question_index = 0
            else:
                # Without randomization: find index in original question order
                for i, question in enumerate(self.questions):
                    if question["id"] == last_answered_question_id:
                        next_question_index = i + 1
                        break

        # Ensure we don't go beyond available questions
        if next_question_index >= len(self.questions):
            next_question_index = len(self.questions)

        # A test whose time ran out while the page was closed is finished now
        if not self._is_test_completed(user_id) and self._time_is_up(user_data):
            await self._finish_user_test(user_id, "timeout")

        # Check if test is completed
        test_completed = self._is_test_completed(user_id)

        response_data = {
            "valid": True,
            "user_id": user_id,
            "username": username,
            "approved": approved,
            "next_question_index": next_question_index,
            "total_questions": len(self.questions),
            "last_answered_question_id": last_answered_question_id,
            "test_completed": test_completed,
            "quiz_start_time": user_data.get("quiz_start_time", datetime.now()).isoformat(),
            # State for restoring the quiz page after a reload
            "time_limit": user_data.get("time_limit", self.time_limit_s),
            "remaining_seconds": self._remaining_seconds(user_data),
            "allow_skip_questions": user_data.get("allow_skip_questions", self.allow_skip_questions),
            "answered_questions": {
                str(question_id): result["selected_answer"]
                for question_id, result in self.answer_results.get(user_id, {}).items()
            },
            "skipped_questions": user_data.get("skipped_questions", []),
        }

        # Include question_order if randomization is enabled
        if self.randomize_questions and "question_order" in user_data:
            response_data["question_order"] = user_data["question_order"]

        if test_completed:
            # Get final results for completed test
            final_results = self.get_user_final_results(user_id)
            response_data["final_results"] = final_results
            logger.info(f"User {user_id} verification: test completed, returning final results")
        else:
            logger.info(
                f"User {user_id} verification: last_answered={last_answered_question_id}, next_index={next_question_index}"
            )

        return web.json_response(response_data)

    # Admin API endpoints
    @admin_auth_required
    async def admin_list_quizzes(self, request):
        """List available quiz files.

        Returns:
            JSON response with list of quiz files and current quiz
        """
        quizzes = await self.list_available_quizzes()
        return web.json_response(
            {
                "quizzes": quizzes,
                "current_quiz": self._current_quiz_name(),
                "force_all_completed": self.force_all_completed,
                "show_answers_on_completion": self.show_answers_on_completion,
            }
        )

    @admin_auth_required
    async def admin_switch_quiz(self, request):
        """Switch to a different quiz.

        Args:
            request: aiohttp request with quiz_filename

        Returns:
            JSON response with success status and new quiz info
        """
        data = await request.json()
        quiz_filename = data["quiz_filename"]

        await self.switch_quiz(quiz_filename)

        return web.json_response(
            {
                "success": True,
                "message": self._t("quiz_switched", name=quiz_filename),
                "current_quiz": self._current_quiz_name(),
                "csv_file": os.path.basename(self.csv_file),
            }
        )

    @local_network_only
    async def admin_auth(self, request):
        """Authenticate admin with master key and create session.

        Validates master key from request body,
        creates a new session token, and sets it as a cookie.
        Trusted IPs bypass master key validation.

        Returns:
            JSON response confirming authentication succeeded with session cookie
        """
        # Check if it's in trusted list (bypass master key validation)
        client_ip = get_client_ip(request)
        is_trusted = hasattr(self, "admin_config") and client_ip in self.admin_config.trusted_ips

        if not is_trusted:
            # Check if master key is configured
            if not self.master_key:
                return web.json_response({"error": self._t("admin_disabled")}, status=403)

            # Get master key from request body only
            provided_key = None
            try:
                data = await request.json()
                provided_key = data.get("master_key")
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
            except Exception as e:
                logger.exception(f"Unexpected error reading admin auth request body: {e}")

            if not provided_key or provided_key != self.master_key:
                return web.json_response({"error": self.translations["server_invalid_master_key"]}, status=401)

        # Generate a new session token
        session_token = secrets.token_urlsafe(32)
        self.admin_sessions[session_token] = datetime.now()

        # Create response with session cookie
        response = web.json_response({"authenticated": True, "message": self._t("auth_success")})
        response.set_cookie(
            "admin_session",
            session_token,
            httponly=True,
            samesite="Strict",
            path="/",
        )
        return response

    @local_network_only
    async def admin_check_session(self, request):
        """Check if admin session cookie is valid.

        Used for auto-authentication on page load without requiring master key.

        Returns:
            JSON response with session validity status
        """
        session_token = request.cookies.get("admin_session")

        if not session_token:
            return web.json_response({"valid": False, "reason": "No session cookie"}, status=401)

        if session_token not in self.admin_sessions:
            return web.json_response({"valid": False, "reason": "Invalid session"}, status=401)

        return web.json_response({"valid": True, "message": self._t("session_valid")})

    @local_network_only
    async def admin_version_check(self, request):
        """Check if a newer package version is available on disk.

        Compares the in-memory package version with the version from the
        __init__.py file to detect if the package was updated while running.

        Returns:
            JSON response with version info and restart_required flag
        """
        running_version = get_package_version()
        file_version = get_file_version()

        restart_required = (
            running_version != "unknown" and file_version != "unknown" and running_version != file_version
        )

        return web.json_response(
            {"running_version": running_version, "file_version": file_version, "restart_required": restart_required}
        )

    @admin_auth_required
    async def admin_approve_user(self, request):
        """Approve a user for testing.

        Marks user as approved, starts timing, initializes live stats,
        and generates random question order if enabled.

        Args:
            request: aiohttp request with user_id

        Returns:
            JSON response with approval confirmation
        """
        data = await request.json()
        user_id = data.get("user_id")

        if not user_id:
            return web.json_response({"error": self._t("user_id_required")}, status=400)

        # Check if user exists
        if user_id not in self.users:
            return web.json_response({"error": self._t("user_not_found")}, status=404)

        user_data = self.users[user_id]

        # Check if already approved
        if user_data.get("approved", False):
            return web.json_response({"success": True, "message": self._t("user_already_approved")})

        # Approve the user
        user_data["approved"] = True

        # Generate random question order if randomization is enabled and not yet generated
        if self.randomize_questions and "question_order" not in user_data:
            user_data["question_order"] = self.generate_random_question_order()
            logger.info(f"Generated random question order for approved user {user_id}: {user_data['question_order']}")

        user_data["time_limit"] = self.time_limit_s
        user_data["allow_skip_questions"] = self.allow_skip_questions
        user_data["quiz_start_time"] = datetime.now()
        self.users[user_id] = user_data

        # Start timing for first question
        self.question_start_times[user_id] = datetime.now()
        self.question_start_ids[user_id] = self._first_question_id(user_data)

        # Initialize live stats: set first question to "think"
        if len(self.questions) > 0:
            # Determine first question ID (use question_order if randomization enabled)
            first_question_id = user_data.get("question_order", [1])[0] if self.randomize_questions else 1

            self.update_live_stats(user_id, first_question_id, "think")

            # Broadcast user approval to live stats WebSocket
            await self.broadcast_to_websockets(
                {
                    "type": "user_registered",
                    "user_id": user_id,
                    "username": user_data["username"],
                    "question_id": first_question_id,
                    "state": "think",
                    "time_taken": None,
                    "total_questions": len(self.questions),
                    "total_points": sum_points(q.get("points", 1) for q in self.questions),
                }
            )

        # Broadcast approval to admin WebSocket
        await self.broadcast_to_admin_websockets({"type": "user_approved", "user_id": user_id})
        await self.notify_admin_user_updated(user_id)

        logger.info(f"Approved user: {user_id}")
        return web.json_response({"success": True, "message": self._t("user_approved"), "user_id": user_id})

    @admin_auth_required
    async def admin_force_show_answers(self, request):
        """Force showing answers to all students by marking quiz as completed.

        Sets the force_all_completed flag to True, which makes all_students_completed()
        return True, triggering the existing answer visibility logic.

        This is a one-way toggle - once set, answers remain visible until
        quiz is switched or server is restarted.

        Args:
            request: aiohttp request

        Returns:
            JSON response with success status
        """
        # Set the flag
        self.force_all_completed = True

        logger.info(
            f"Admin force-enabled answer visibility. "
            f"Completed students: {len(self.user_stats)}, "
            f"Total students: {len(self.users)}"
        )

        # Broadcast to admin WebSocket clients
        await self.broadcast_to_admin_websockets(
            {"type": "answers_forced", "forced": True, "message": self._t("answers_opened")}
        )

        return web.json_response(
            {
                "success": True,
                "forced": True,
                "message": self._t("answers_opened"),
                "completed_count": len(self.user_stats),
                "total_count": len(self.users),
            }
        )

    @admin_auth_required
    async def admin_get_quiz(self, request):
        """Get quiz content for editing.

        Args:
            request: aiohttp request with filename in path

        Returns:
            JSON response with quiz content (raw YAML and parsed)
        """
        filename = request.match_info["filename"]
        quiz_path = self._resolve_quiz_path(filename)
        if not quiz_path:
            return web.json_response({"error": self._t("invalid_quiz_filename")}, status=400)

        if not os.path.exists(quiz_path):
            return web.json_response({"error": self._t("quiz_not_found")}, status=404)

        with open(quiz_path, "r", encoding="utf-8") as f:
            quiz_content = f.read()

        # Also return parsed YAML for wizard mode
        try:
            import yaml

            parsed_quiz = yaml.safe_load(quiz_content)
            return web.json_response({"filename": filename, "content": quiz_content, "parsed": parsed_quiz})
        except yaml.YAMLError as e:
            return web.json_response(
                {"filename": filename, "content": quiz_content, "parsed": None, "yaml_error": str(e)}
            )

    @admin_auth_required
    async def admin_create_quiz(self, request):
        """Create new quiz from wizard or text input.

        Args:
            request: aiohttp request with filename, mode, and quiz data/content

        Returns:
            JSON response with success status
        """
        data = await request.json()
        filename = data.get("filename", "").strip()
        mode = data.get("mode", "wizard")  # 'wizard' or 'text'

        if not filename:
            return web.json_response({"error": self._t("filename_required")}, status=400)

        filename = self._with_quiz_extension(filename).replace("\\", "/")
        quiz_path = self._resolve_quiz_path(filename)
        if not quiz_path:
            return web.json_response({"error": self._t("invalid_quiz_filename")}, status=400)

        # Check if file already exists
        if os.path.exists(quiz_path):
            return web.json_response({"error": self._t("quiz_exists")}, status=409)

        # Validate and create quiz content
        if mode == "wizard":
            quiz_data = data.get("quiz_data", {})
            if not self._validate_quiz_data(quiz_data):
                return web.json_response({"error": self._t("invalid_quiz_structure")}, status=400)

            import yaml

            quiz_content = yaml.dump(quiz_data, default_flow_style=False, allow_unicode=True)
        else:  # text mode
            quiz_content = data.get("content", "").strip()
            if not quiz_content:
                return web.json_response({"error": self._t("quiz_content_required")}, status=400)

            # Validate YAML
            try:
                import yaml

                parsed = yaml.safe_load(quiz_content)
                if not self._validate_quiz_data(parsed):
                    return web.json_response({"error": self._t("invalid_quiz_structure")}, status=400)
            except yaml.YAMLError as e:
                return web.json_response({"error": self._t("invalid_yaml", error=str(e))}, status=400)

        # Write the quiz file with fsync for SD card/slow storage reliability
        self._ensure_parent_dir(quiz_path)
        async with aiofiles.open(quiz_path, "w", encoding="utf-8") as f:
            await f.write(quiz_content)
            await f.flush()
            os.fsync(f.fileno())

        logger.info(f"Created new quiz: {filename}")
        return web.json_response(
            {"success": True, "message": self._t("quiz_created", name=filename), "filename": filename}
        )

    @admin_auth_required
    async def admin_update_quiz(self, request):
        """Update existing quiz.

        Creates backup before updating. Reloads quiz if it's currently active.
        Supports renaming by providing different filename in request body.

        Args:
            request: aiohttp request with filename in path and quiz data

        Returns:
            JSON response with success status and backup filename
        """
        old_filename = request.match_info["filename"]
        data = await request.json()
        mode = data.get("mode", "wizard")

        # Get and validate new filename from request body
        new_filename = data.get("filename", "").strip()
        if not new_filename:
            new_filename = old_filename.replace(".yaml", "").replace(".yml", "")
        if not (new_filename.endswith(".yaml") or new_filename.endswith(".yml")):
            new_filename += ".yaml"

        old_path = self._resolve_quiz_path(old_filename)
        new_path = self._resolve_quiz_path(new_filename)
        if not old_path or not new_path:
            return web.json_response({"error": self._t("invalid_quiz_filename")}, status=400)

        if not os.path.exists(old_path):
            return web.json_response({"error": self._t("quiz_not_found")}, status=404)

        # Check if filename is being changed
        filename_changed = old_filename != new_filename
        if filename_changed:
            # Prevent renaming of currently active quiz
            if self._is_current_quiz(old_filename):
                return web.json_response(
                    {"error": self._t("cannot_rename_active")}, status=409
                )

            # Check for filename conflicts
            if os.path.exists(new_path):
                return web.json_response({"error": self._t("quiz_exists_named", name=new_filename)}, status=409)

        # Use old_path for all operations until rename
        quiz_path = old_path

        # Create backup
        backup_path = quiz_path + ".backup"

        shutil.copy2(quiz_path, backup_path)

        # Prepare new content
        if mode == "wizard":
            quiz_data = data.get("quiz_data", {})
            if not self._validate_quiz_data(quiz_data):
                return web.json_response({"error": self._t("invalid_quiz_structure")}, status=400)

            quiz_content = yaml.dump(quiz_data, default_flow_style=False, allow_unicode=True)
        else:  # text mode
            quiz_content = data.get("content", "").strip()
            if not quiz_content:
                return web.json_response({"error": self._t("quiz_content_required")}, status=400)

            # Validate YAML
            try:
                parsed = yaml.safe_load(quiz_content)
                if not self._validate_quiz_data(parsed):
                    return web.json_response({"error": self._t("invalid_quiz_structure")}, status=400)
            except yaml.YAMLError as e:
                return web.json_response({"error": self._t("invalid_yaml", error=str(e))}, status=400)

        # Write updated content with fsync for SD card/slow storage reliability
        async with aiofiles.open(quiz_path, "w", encoding="utf-8") as f:
            await f.write(quiz_content)
            await f.flush()
            os.fsync(f.fileno())

        # Rename file if filename changed (only for inactive quizzes)
        if filename_changed:
            self._ensure_parent_dir(new_path)
            os.rename(old_path, new_path)
            logger.info(f"Renamed quiz: {old_filename} -> {new_filename}")

        # Determine final filename for reload check
        final_filename = new_filename if filename_changed else old_filename

        # If this is the current quiz, reload it
        if self._is_current_quiz(final_filename):
            await self.switch_quiz(final_filename)

        logger.info(f"Updated quiz: {final_filename}")
        return web.json_response(
            {
                "success": True,
                "message": self._t("quiz_updated", name=final_filename),
                "backup_created": os.path.basename(backup_path),
                "filename": final_filename,
                "renamed": filename_changed,
            }
        )

    @admin_auth_required
    async def admin_delete_quiz(self, request):
        """Delete quiz file.

        Creates backup before deletion. Prevents deleting currently active quiz.

        Args:
            request: aiohttp request with filename in path

        Returns:
            JSON response with success status and backup filename
        """
        filename = request.match_info["filename"]
        quiz_path = self._resolve_quiz_path(filename)
        if not quiz_path:
            return web.json_response({"error": self._t("invalid_quiz_filename")}, status=400)

        if not os.path.exists(quiz_path):
            return web.json_response({"error": self._t("quiz_not_found")}, status=404)

        # Don't allow deleting the current quiz
        if self._is_current_quiz(filename):
            return web.json_response({"error": self._t("cannot_delete_active")}, status=400)

        # Create backup before deletion
        backup_path = quiz_path + ".deleted_backup"
        import shutil

        shutil.copy2(quiz_path, backup_path)

        # Delete the file
        os.remove(quiz_path)

        logger.info(f"Deleted quiz: {filename} (backup: {backup_path})")
        return web.json_response(
            {
                "success": True,
                "message": self._t("quiz_deleted", name=filename),
                "backup_created": os.path.basename(backup_path),
            }
        )

    @admin_auth_required
    async def admin_unite_quizzes(self, request):
        """Unite multiple quizzes into a single new quiz file.

        Takes config from first quiz, combines questions from all in order.

        Args:
            request: aiohttp request with:
                - quiz_filenames: List of quiz filenames to unite
                - new_name: Name for the united quiz file

        Returns:
            JSON response with success status, filename, and total question count
        """
        data = await request.json()
        quiz_filenames = data.get("quiz_filenames", [])
        new_name = data.get("new_name", "").strip()

        # Validation
        if not quiz_filenames or len(quiz_filenames) < 2:
            return web.json_response(
                {"error": self._t("unite_two_needed")},
                status=400,
            )

        if not new_name:
            return web.json_response(
                {"error": self._t("unite_name_required")},
                status=400,
            )

        # Add .yaml extension if not present
        new_name = self._with_quiz_extension(new_name).replace("\\", "/")
        new_quiz_path = self._resolve_quiz_path(new_name)
        if not new_quiz_path:
            return web.json_response({"error": self._t("invalid_quiz_filename")}, status=400)

        # Check new filename doesn't exist
        if os.path.exists(new_quiz_path):
            return web.json_response(
                {"error": self._t("unite_exists", name=new_name)},
                status=409,
            )

        # Load and validate all quizzes
        quizzes_data = []
        for filename in quiz_filenames:
            quiz_path = self._resolve_quiz_path(filename)
            if not quiz_path or not os.path.exists(quiz_path):
                return web.json_response(
                    {"error": self._t("unite_not_found", name=filename)},
                    status=404,
                )

            try:
                with open(quiz_path, "r", encoding="utf-8") as f:
                    quiz_content = yaml.safe_load(f)
                    errors = []
                    if not self._validate_quiz_data(quiz_content, errors):
                        return web.json_response(
                            {
                                "error": self._t(
                                    "unite_invalid",
                                    name=filename,
                                    error=errors[0] if errors else self._t("unite_unknown_error"),
                                )
                            },
                            status=400,
                        )
                    quizzes_data.append(quiz_content)
            except yaml.YAMLError as e:
                return web.json_response(
                    {"error": self._t("unite_read_error", name=filename, error=str(e))},
                    status=400,
                )

        # Take config from first quiz
        united_quiz = {
            "title": quizzes_data[0].get("title", "United Quiz"),
            "questions": [],
        }

        # Copy optional config fields from first quiz
        optional_fields = [
            "description",
            "show_right_answer",
            "randomize_questions",
            "min_correct",
            "show_answers_on_completion",
            "show_final_list",
        ]
        for field in optional_fields:
            if field in quizzes_data[0]:
                united_quiz[field] = quizzes_data[0][field]

        # Combine questions from all quizzes
        seen_questions = set()  # Track duplicate questions by text+file
        duplicate_count = 0

        for quiz_data in quizzes_data:
            for question in quiz_data.get("questions", []):
                # Check for duplicate by question text and file
                question_text = question.get("question", "") or question.get("image", "")
                question_file = question.get("file", "")
                question_key = (question_text, question_file)
                if question_key in seen_questions:
                    duplicate_count += 1
                else:
                    seen_questions.add(question_key)

                united_quiz["questions"].append(question)

        # Write the new quiz file with fsync for reliability
        self._ensure_parent_dir(new_quiz_path)
        async with aiofiles.open(new_quiz_path, "w", encoding="utf-8") as f:
            await f.write(yaml.dump(united_quiz, default_flow_style=False, allow_unicode=True))
            await f.flush()
            os.fsync(f.fileno())

        logger.info(
            f"United {len(quiz_filenames)} quizzes into '{new_name}': " f"{len(united_quiz['questions'])} questions"
        )

        response_data = {
            "success": True,
            "message": self._t("united"),
            "filename": new_name,
            "total_questions": len(united_quiz["questions"]),
            "source_quizzes": quiz_filenames,
        }

        if duplicate_count > 0:
            response_data["warning"] = self._t("unite_duplicates", count=duplicate_count)

        return web.json_response(response_data)

    @admin_auth_required
    async def admin_validate_quiz(self, request):
        """Validate quiz YAML structure.

        Args:
            request: aiohttp request with quiz content

        Returns:
            JSON response with validation result and errors if any
        """
        data = await request.json()
        content = data.get("content", "").strip()

        if not content:
            return web.json_response({"valid": False, "errors": ["Content is empty"]})

        try:
            import yaml

            parsed = yaml.safe_load(content)

            # Validate structure
            errors = []
            if not self._validate_quiz_data(parsed, errors):
                return web.json_response({"valid": False, "errors": errors})

            return web.json_response(
                {"valid": True, "parsed": parsed, "question_count": len(parsed.get("questions", []))}
            )
        except yaml.YAMLError as e:
            return web.json_response({"valid": False, "errors": [f"YAML syntax error: {str(e)}"]})

    def _validate_quiz_data(self, data, errors=None):
        """Validate quiz data structure.

        Checks for required fields, valid data types, correct answer indices,
        and optional settings like min_correct, show_right_answer, etc.

        Args:
            data: Quiz data dictionary to validate
            errors: Optional list to append error messages to

        Returns:
            True if valid, False otherwise (errors list contains details)
        """
        if errors is None:
            errors = []

        if not isinstance(data, dict):
            errors.append(self._t("quiz_not_dict"))
            return False

        if "questions" not in data:
            errors.append(self._t("quiz_no_questions"))
            return False

        questions = data["questions"]
        if not isinstance(questions, list):
            errors.append(self._t("questions_not_list"))
            return False

        if len(questions) == 0:
            errors.append(self._t("quiz_empty"))
            return False

        for i, question in enumerate(questions):
            if not isinstance(question, dict):
                errors.append(self._t("q_not_dict", n=i + 1))
                continue

            # Check if this is a text input question (has checker)
            is_text_question = "checker" in question

            # Either question text OR image must be provided (for all question types)
            has_question = "question" in question and question["question"]
            has_image = "image" in question and question["image"]
            if not has_question and not has_image:
                errors.append(self._t("q_text_or_image", n=i + 1))

            if is_text_question:
                # Text input question validation
                # Optional fields: default_value, correct_value, checker
                if "default_value" in question and not isinstance(question["default_value"], str):
                    errors.append(self._t("q_field_str", n=i + 1, field="default_value"))
                if "correct_value" in question and not isinstance(question["correct_value"], str):
                    errors.append(self._t("q_field_str", n=i + 1, field="correct_value"))
                if "checker" in question and not isinstance(question["checker"], str):
                    errors.append(self._t("q_field_str", n=i + 1, field="checker"))

                # Validate checker is valid Python syntax
                checker_code = question.get("checker", "")
                if checker_code and isinstance(checker_code, str):
                    try:
                        compile(checker_code, f"<question {i+1} checker>", "exec")
                    except SyntaxError as e:
                        errors.append(self._t("q_checker_syntax", n=i + 1, error=e.msg, line=e.lineno))

            else:
                # Choice question validation
                # Validate required fields
                required_fields = ["options", "correct_answer"]
                for field in required_fields:
                    if field not in question:
                        errors.append(self._t("q_missing_field", n=i + 1, field=field))

                # Validate options
                if "options" in question:
                    options = question["options"]
                    if not isinstance(options, list):
                        errors.append(self._t("q_options_list", n=i + 1))
                    elif len(options) < 2:
                        errors.append(self._t("q_two_options", n=i + 1))
                    elif not all(isinstance(opt, str) for opt in options):
                        errors.append(self._t("q_options_strings", n=i + 1))

            # Validate correct_answer (can be integer for single answer or list for multiple answers)
            # Only for choice questions
            if not is_text_question and "correct_answer" in question and "options" in question:
                correct_answer = question["correct_answer"]
                options_count = len(question["options"])

                if isinstance(correct_answer, int):
                    # Single answer validation
                    if correct_answer < 0 or correct_answer >= options_count:
                        errors.append(self._t("q_correct_range", n=i + 1))
                elif isinstance(correct_answer, list):
                    # Multiple answers validation
                    if len(correct_answer) == 0:
                        errors.append(self._t("q_correct_empty", n=i + 1))
                    elif not all(isinstance(idx, int) for idx in correct_answer):
                        errors.append(self._t("q_correct_ints", n=i + 1))
                    elif any(idx < 0 or idx >= options_count for idx in correct_answer):
                        errors.append(self._t("q_correct_array_range", n=i + 1))
                    elif len(set(correct_answer)) != len(correct_answer):
                        errors.append(self._t("q_correct_duplicates", n=i + 1))
                else:
                    errors.append(self._t("q_correct_type", n=i + 1))

            # Validate min_correct (only valid for multiple choice questions)
            if not is_text_question and "min_correct" in question:
                min_correct = question["min_correct"]
                if "correct_answer" not in question:
                    errors.append(self._t("q_min_no_correct", n=i + 1))
                elif not isinstance(question["correct_answer"], list):
                    errors.append(self._t("q_min_multiple_only", n=i + 1))
                elif not isinstance(min_correct, int):
                    errors.append(self._t("q_min_int", n=i + 1))
                elif min_correct < 1:
                    errors.append(self._t("q_min_positive", n=i + 1))
                elif min_correct > len(question["correct_answer"]):
                    errors.append(self._t("q_min_exceeds", n=i + 1))

            # Validate points (valid for all question types)
            if "points" in question:
                points = question["points"]
                if isinstance(points, bool) or not isinstance(points, (int, float)):
                    errors.append(self._t("q_points_number", n=i + 1))
                elif points <= 0:
                    errors.append(self._t("q_points_positive", n=i + 1))
                elif round(points, POINTS_DECIMAL_PLACES) != points:
                    errors.append(self._t("q_points_decimals", n=i + 1, places=POINTS_DECIMAL_PLACES))

            # Validate stick_to_the_previous (valid for all question types)
            if "stick_to_the_previous" in question:
                stick_value = question["stick_to_the_previous"]
                if not isinstance(stick_value, bool):
                    errors.append(self._t("q_sticky_bool", n=i + 1))
                elif i == 0 and stick_value is True:
                    errors.append(self._t("q_first_sticky"))

        # Validate optional top-level fields
        if "show_right_answer" in data and not isinstance(data["show_right_answer"], bool):
            errors.append(self._t("quiz_field_bool", field="show_right_answer"))

        if "randomize_questions" in data and not isinstance(data["randomize_questions"], bool):
            errors.append(self._t("quiz_field_bool", field="randomize_questions"))

        if "show_final_list" in data and not isinstance(data["show_final_list"], bool):
            errors.append(self._t("quiz_field_bool", field="show_final_list"))

        if "title" in data and not isinstance(data["title"], str):
            errors.append(self._t("quiz_title_str"))

        return len(errors) == 0

    def _validate_config_data(self, data, errors=None):
        """Validate server configuration data structure.

        All sections are optional - empty config is valid.
        Validates structure and types for server, paths, admin, registration, and quizzes sections.

        Args:
            data: Config data dictionary to validate
            errors: Optional list to append error messages to

        Returns:
            True if valid, False otherwise (errors list contains details)
        """
        if errors is None:
            errors = []

        # Config can be None or empty dict - both are valid
        if data is None:
            return True

        if not isinstance(data, dict):
            errors.append(self._t("config_not_dict"))
            return False

        # Validate language (optional)
        if "language" in data:
            if data["language"] == "ru":
                errors.append("російська мова не підтримується, але ти москалику попався")
            elif data["language"] not in ("uk", "en"):
                errors.append(self._t("language_invalid"))

        # Validate extra_answers_with_users_csv (optional)
        if "extra_answers_with_users_csv" in data:
            if not isinstance(data["extra_answers_with_users_csv"], bool):
                errors.append(self._t("field_bool", field="extra_answers_with_users_csv"))

        # Validate question_navigation (optional)
        if "question_navigation" in data:
            if not isinstance(data["question_navigation"], bool):
                errors.append(self._t("field_bool", field="question_navigation"))

        # Validate server section (optional)
        if "server" in data:
            server = data["server"]
            if not isinstance(server, dict):
                errors.append(self._t("section_dict", field="server"))
            else:
                if "host" in server and not isinstance(server["host"], str):
                    errors.append(self._t("field_str", field="server.host"))
                if "port" in server:
                    if not isinstance(server["port"], int):
                        errors.append(self._t("port_int"))
                    elif server["port"] < 1 or server["port"] > 65535:
                        errors.append(self._t("port_range"))

        # Validate paths section (optional)
        if "paths" in data:
            paths = data["paths"]
            if not isinstance(paths, dict):
                errors.append(self._t("section_dict", field="paths"))
            else:
                path_fields = ["quizzes_dir", "logs_dir", "csv_dir", "static_dir"]
                for field in path_fields:
                    if field in paths and not isinstance(paths[field], str):
                        errors.append(self._t("field_str", field=f"paths.{field}"))

        # Validate admin section (optional)
        if "admin" in data:
            admin = data["admin"]
            if not isinstance(admin, dict):
                errors.append(self._t("section_dict", field="admin"))
            else:
                if "master_key" in admin:
                    if admin["master_key"] is not None and not isinstance(admin["master_key"], str):
                        errors.append(self._t("master_key_type"))
                if "trusted_ips" in admin:
                    if not isinstance(admin["trusted_ips"], list):
                        errors.append(self._t("field_list", field="admin.trusted_ips"))
                    elif not all(isinstance(ip, str) for ip in admin["trusted_ips"]):
                        errors.append(self._t("field_list_str", field="admin.trusted_ips"))

        # Validate registration section (optional)
        if "registration" in data:
            registration = data["registration"]
            if not isinstance(registration, dict):
                errors.append(self._t("section_dict", field="registration"))
            else:
                if "fields" in registration:
                    if not isinstance(registration["fields"], list):
                        errors.append(self._t("field_list", field="registration.fields"))
                    elif not all(isinstance(field, str) for field in registration["fields"]):
                        errors.append(self._t("field_list_str", field="registration.fields"))
                if "disabled_fields" in registration:
                    if not isinstance(registration["disabled_fields"], list):
                        errors.append(self._t("field_list", field="registration.disabled_fields"))
                    elif not all(isinstance(field, str) for field in registration["disabled_fields"]):
                        errors.append(self._t("field_list_str", field="registration.disabled_fields"))
                if "approve" in registration:
                    if not isinstance(registration["approve"], bool):
                        errors.append(self._t("field_bool", field="registration.approve"))
                if "username_label" in registration:
                    if not isinstance(registration["username_label"], str):
                        errors.append(self._t("field_str", field="registration.username_label"))

        # Validate appearance section (optional)
        if "appearance" in data:
            appearance = data["appearance"]
            if appearance is None:
                pass
            elif not isinstance(appearance, dict):
                errors.append(self._t("section_dict", field="appearance"))
            else:
                color = appearance.get("background_color")
                if color is not None and (not isinstance(color, str) or not HEX_COLOR_RE.match(color)):
                    errors.append(self._t("hex_color", field="appearance.background_color"))
                image = appearance.get("background_image")
                if image is not None and not isinstance(image, str):
                    errors.append(self._t("field_str", field="appearance.background_image"))

        # Validate quizzes section (optional)
        if "quizzes" in data:
            quizzes = data["quizzes"]
            if not isinstance(quizzes, list):
                errors.append(self._t("section_list", field="quizzes"))
            else:
                for i, quiz in enumerate(quizzes):
                    if not isinstance(quiz, dict):
                        errors.append(self._t("quiz_item_dict", n=i + 1))
                        continue

                    # Check required fields for each quiz
                    required_quiz_fields = ["name", "download_path", "folder"]
                    for field in required_quiz_fields:
                        if field not in quiz:
                            errors.append(self._t("quiz_item_missing", n=i + 1, field=field))
                        elif not isinstance(quiz[field], str):
                            errors.append(self._t("quiz_item_str", n=i + 1, field=field))

        return len(errors) == 0

    @admin_auth_required
    async def admin_list_images(self, request):
        """List all images in quizzes/imgs directory.

        Returns:
            JSON response with list of image files and their paths
        """
        imgs_dir = os.path.join(self.quizzes_dir, "imgs")
        if not os.path.exists(imgs_dir):
            return web.json_response({"images": []})

        image_files = []
        for root, dirs, files in os.walk(imgs_dir):
            dirs.sort()  # Обходимо папки в алфавітному порядку
            for filename in files:
                if filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg")):
                    # Відносний шлях від imgs_dir, наприклад "cats/cat1.png"
                    rel_path = os.path.relpath(os.path.join(root, filename), imgs_dir)
                    rel_path = rel_path.replace("\\", "/")  # Windows сумісність
                    image_files.append({
                        "filename": filename,
                        "path": f"/imgs/{rel_path}",
                        "folder": os.path.dirname(rel_path) or "imgs",
                    })

        image_files.sort(key=lambda x: (x["folder"], x["filename"].lower()))

        return web.json_response({"images": image_files})

    @admin_auth_required
    async def admin_list_files(self, request):
        """List all files in quizzes/attach directory.

        Returns:
            JSON response with list of files (filename, path, size)
        """
        files_dir = os.path.join(self.quizzes_dir, "attach")
        if not os.path.exists(files_dir):
            return web.json_response({"files": []})

        file_list = []
        for filename in os.listdir(files_dir):
            file_path = os.path.join(files_dir, filename)
            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                file_list.append(
                    {
                        "filename": filename,
                        "path": f"/attach/{filename}",
                        "size": file_size,
                    }
                )

        # Sort alphabetically by filename (case-insensitive)
        file_list.sort(key=lambda x: x["filename"].lower())

        return web.json_response({"files": file_list})

    @admin_auth_required
    async def admin_list_checker_templates(self, request):
        """List all checker templates from configuration.

        Returns:
            JSON response with list of templates (name, code)
        """
        templates = []
        if hasattr(self.config, "checker_templates") and self.config.checker_templates.templates:
            for template in self.config.checker_templates.templates:
                templates.append({"name": template.name, "code": template.code})

        return web.json_response({"templates": templates})

    async def serve_quiz_file(self, request):
        """Serve quiz file for download.

        Serves files from quizzes/attach directory with Content-Disposition: attachment
        to force browser download.

        Args:
            request: aiohttp request with filename in path

        Returns:
            File response with attachment disposition header
        """
        filename = request.match_info["filename"]

        # Validate filename (prevent path traversal)
        if not self._is_safe_filename(filename):
            return web.json_response({"error": self._t("invalid_filename")}, status=400)

        files_dir = os.path.join(self.quizzes_dir, "attach")
        file_path = os.path.join(files_dir, filename)

        # Check if file exists
        if not os.path.exists(file_path):
            return web.json_response({"error": self._t("file_not_found")}, status=404)

        # Check if it's actually a file (not directory)
        if not os.path.isfile(file_path):
            return web.json_response({"error": self._t("not_a_file")}, status=400)

        # Return file response with attachment disposition to force download
        return web.FileResponse(
            file_path,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @admin_auth_required
    async def admin_download_quiz(self, request):
        """Download and extract quiz from ZIP file.

        Downloads ZIP from HTTPS URL, extracts specified folder to quizzes directory.

        Args:
            request: aiohttp request with name, download_path, and folder

        Returns:
            JSON response with extraction results and updated quiz list
        """
        data = await request.json()
        name = data.get("name")
        download_path = data.get("download_path")
        folder = data.get("folder")

        if not name or not download_path:
            return web.json_response({"error": self._t("download_fields_required")}, status=400)

        # Check for absolute paths (Unix-style or Windows-style). Rooted paths are
        # checked explicitly: on Windows, Python 3.13+ isabs("/etc") is False (no drive)
        if os.path.isabs(folder) or folder.startswith(("/", "\\")) or (len(folder) >= 2 and folder[1] == ":"):
            return web.json_response({"error": self._t("folder_absolute")}, status=400)

        # Check for path traversal attempts before normalization
        if ".." in folder:
            return web.json_response({"error": self._t("folder_parent")}, status=400)

        # Normalize the path to handle different separators
        normalized_folder = os.path.normpath(folder)

        # Double-check after normalization
        if ".." in normalized_folder:
            return web.json_response({"error": self._t("folder_parent")}, status=400)

        # Ensure the normalized path doesn't escape the quizzes directory
        test_path = os.path.normpath(os.path.join(self.quizzes_dir, normalized_folder))
        quizzes_dir_normalized = os.path.normpath(self.quizzes_dir) + os.sep
        test_path_normalized = test_path + os.sep

        if not test_path_normalized.startswith(quizzes_dir_normalized):
            return web.json_response({"error": self._t("folder_traversal")}, status=400)

        folder = normalized_folder

        # Download and extract the ZIP file using temporary directory
        try:
            # Download the ZIP file
            logger.info(f"Downloading quiz from {download_path}")
            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                response = await client.get(download_path)
                response.raise_for_status()

                # Use temporary directory for extraction (auto-cleanup)
                with tempfile.TemporaryDirectory() as temp_dir:
                    # Save ZIP file
                    zip_path = os.path.join(temp_dir, f"{name.replace(' ', '_')}.zip")
                    async with aiofiles.open(zip_path, "wb") as zip_file:
                        await zip_file.write(response.content)

                    # Extract ZIP
                    logger.info(f"Extracting ZIP to {temp_dir}")
                    with zipfile.ZipFile(zip_path, "r") as zip_ref:
                        file_list = zip_ref.namelist()
                        logger.info(f"ZIP contains {len(file_list)} files")
                        zip_ref.extractall(temp_dir)

                    source_path = os.path.join(temp_dir, folder)

                    # Verify source path exists
                    if not os.path.exists(source_path):
                        raise ValueError(
                            f"Folder '{folder}' not found in ZIP archive. Available paths: {os.listdir(temp_dir)}"
                        )

                    # Move everything from source to quizzes directory
                    logger.info(f"Moving contents from {source_path} to {self.quizzes_dir}")
                    shutil.copytree(source_path, self.quizzes_dir, dirs_exist_ok=True)

                    # Update the quiz list
                    await self.list_available_quizzes()

                    return web.json_response({"success": True, "message": self._t("quiz_downloaded", name=name)})

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error downloading quiz: {e.response.status_code} - {e}")
            return web.json_response({"error": self._t("download_http", status=e.response.status_code)}, status=500)

        except httpx.RequestError as e:
            logger.error(f"Network error downloading quiz: {e}")
            return web.json_response({"error": self._t("network_error", error=str(e))}, status=500)

        except zipfile.BadZipFile as e:
            logger.error(f"Invalid ZIP file: {e}")
            return web.json_response({"error": self._t("not_zip")}, status=500)

        except ValueError as e:
            logger.error(f"Validation error: {e}")
            return web.json_response({"error": str(e)}, status=400)

    @admin_auth_required
    async def admin_update_config(self, request):
        """Update server configuration file and apply changes.

        Validates YAML syntax and structure, writes to file, then hot-reloads
        configuration and restarts current quiz if one is active.

        Accepts two formats:
        - {"content": "yaml string"} — direct YAML content (existing flow)
        - {"data": {section: {...}}} — JSON partial update (merges into existing config)

        Args:
            request: aiohttp request with config content

        Returns:
            JSON response with success status, config_content and config_data
        """
        request_data = await request.json()

        # Get config file path (use the actual path that was loaded)
        config_path = self.config.config_path
        if not config_path:
            return web.json_response(
                {"error": self._t("no_config_file")}, status=400
            )

        # Determine format: JSON data merge or direct YAML content
        if "data" in request_data:
            # JSON partial update: merge into existing config
            merge_data = request_data["data"]
            if not isinstance(merge_data, dict):
                return web.json_response({"error": self._t("data_not_dict")}, status=400)

            # Use ruamel.yaml in round-trip mode so comments and blank lines
            # between sections survive partial saves from the admin web form.
            rt_yaml = RuamelYAML()
            rt_yaml.preserve_quotes = True
            rt_yaml.allow_unicode = True
            rt_yaml.indent(mapping=2, sequence=4, offset=2)

            # Read current config preserving comments/structure
            current_config = None
            if os.path.exists(config_path):
                try:
                    async with aiofiles.open(config_path, "r", encoding="utf-8") as f:
                        current_content = await f.read()
                    if current_content.strip():
                        current_config = rt_yaml.load(current_content)
                except Exception:
                    current_config = None

            if not isinstance(current_config, dict):
                current_config = rt_yaml.load("{}\n") or {}

            # Shallow-merge each section so existing keys/comments inside a
            # section are kept when the form only sets some of them.
            for section_key, section_value in merge_data.items():
                if isinstance(section_value, dict) and isinstance(current_config.get(section_key), dict):
                    for k, v in section_value.items():
                        current_config[section_key][k] = v
                else:
                    current_config[section_key] = section_value

            buf = StringIO()
            rt_yaml.dump(current_config, buf)
            content = buf.getvalue()
        else:
            content = request_data.get("content", "").strip()

        # Validate YAML syntax
        try:
            parsed_config = yaml.safe_load(content) if content else {}
        except yaml.YAMLError as e:
            return web.json_response({"error": self._t("invalid_yaml_syntax", error=str(e))}, status=400)

        # Validate config structure
        errors = []
        if not self._validate_config_data(parsed_config, errors):
            return web.json_response({"error": self._t("config_invalid"), "errors": errors}, status=400)

        # Read original config for rollback if apply fails
        original_content = None
        if os.path.exists(config_path):
            async with aiofiles.open(config_path, "r", encoding="utf-8") as f:
                original_content = await f.read()

        # Write to config file with fsync for SD card/slow storage reliability
        async with aiofiles.open(config_path, "w", encoding="utf-8") as f:
            await f.write(content if content else "")
            await f.flush()
            os.fsync(f.fileno())

        logger.info(f"Configuration file updated: {config_path}")

        restart_reasons = []

        try:
            # Hot-reload configuration and apply changes
            new_config = self.reload_config_from_file()

            # Preserve config_path in new config
            new_config.config_path = config_path

            # Check for changes that require server restart
            restart_reasons = self._config_requires_restart(new_config, parsed_config)

            # Apply hot-reloadable changes
            await self.apply_config_changes(new_config)

            # Restart current quiz if one is running
            await self.restart_current_quiz()
        except Exception as e:
            logger.error(f"Failed to apply config changes: {e}")
            # Rollback config file to original content
            if original_content is not None:
                async with aiofiles.open(config_path, "w", encoding="utf-8") as f:
                    await f.write(original_content)
                    await f.flush()
                    os.fsync(f.fileno())
                logger.info("Configuration file rolled back to previous state")
            return web.json_response(
                {
                    "success": False,
                    "error": self._t("config_apply_failed", error=str(e)),
                    "config_path": config_path,
                },
                status=500,
            )

        # Build response message based on restart requirements
        if restart_reasons:
            message = self._t("config_saved_restart", reasons=", ".join(restart_reasons))
        elif self.current_quiz_file:
            message = self._t("config_saved_restarted")
        else:
            message = self._t("config_saved")

        # Read back saved content and parse for response
        saved_content = ""
        saved_data = config_form_data({"language": self.config.language})
        try:
            async with aiofiles.open(config_path, "r", encoding="utf-8") as f:
                saved_content = await f.read()
            saved_data = config_form_data(yaml.safe_load(saved_content) if saved_content.strip() else {})
        except Exception:
            pass

        return web.json_response(
            {
                "success": True,
                "message": message,
                "config_path": config_path,
                "restart_required": restart_reasons,
                "config_content": saved_content,
                "config_data": saved_data,
            }
        )

    @admin_auth_required
    async def tunnel_connect(self, request):
        """Connect SSH tunnel.

        Args:
            request: aiohttp request

        Returns:
            JSON response with success status and URL or error
        """
        if not self.tunnel_manager:
            return web.json_response({"error": self._t("tunnel_not_configured")}, status=400)

        success, result = await self.tunnel_manager.connect()

        if success:
            logger.info(f"Tunnel connected: {result}")
            return web.json_response({"success": True, "url": result})
        else:
            logger.error(f"Tunnel connection failed: {result}")
            return web.json_response({"error": result}, status=500)

    @admin_auth_required
    async def tunnel_disconnect(self, request):
        """Disconnect SSH tunnel.

        Args:
            request: aiohttp request

        Returns:
            JSON response with success status
        """
        if not self.tunnel_manager:
            return web.json_response({"error": self._t("tunnel_not_configured")}, status=400)

        await self.tunnel_manager.disconnect()
        logger.info("Tunnel disconnected")
        return web.json_response({"success": True})

    @admin_auth_required
    async def admin_transfer_state(self, request):
        """Get file transfer state: own server name, sent offers, incoming requests."""
        return web.json_response(self.transfer.get_state())

    @admin_auth_required
    async def admin_transfer_send(self, request):
        """Offer files to another server on the same tunnel server.

        Body: {"to": "socket-name", "files": [{"type": "quizzes|logs|csv", "name": "..."}]}
        """
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": self._t("invalid_json")}, status=400)
        if not isinstance(data, dict):
            return web.json_response({"error": self._t("invalid_request")}, status=400)
        try:
            offer = await self.transfer.send_offer(data.get("to"), data.get("files"))
        except TransferError as e:
            return web.json_response({"error": e.message}, status=e.status)
        return web.json_response({"success": True, "offer": offer})

    @admin_auth_required
    async def admin_transfer_accept(self, request):
        """Accept an incoming transfer request and download its files.

        Optional body: {"files": [{"type", "name", "action": "save|replace|rename|skip", "new_name"}]}
        Files without a choice get their default action. On invalid choices
        nothing is downloaded and the request stays open (400).
        """
        choices = None
        if request.can_read_body:
            try:
                data = await request.json()
            except Exception:
                return web.json_response({"error": self._t("invalid_json")}, status=400)
            choices = data.get("files") if isinstance(data, dict) else None
        try:
            result = await self.transfer.accept(request.match_info["request_id"], choices)
        except TransferError as e:
            return web.json_response({"error": e.message}, status=e.status)
        return web.json_response({"success": True, **result})

    @admin_auth_required
    async def admin_transfer_reject(self, request):
        """Reject an incoming transfer request."""
        try:
            await self.transfer.reject(request.match_info["request_id"])
        except TransferError as e:
            return web.json_response({"error": e.message}, status=e.status)
        return web.json_response({"success": True})

    def _config_page_data(self) -> dict:
        """Config file path, content and structured data for the settings page form editor."""
        # Config file content and structured data for the form editor (only if a config file was provided)
        config_path = self.config.config_path
        config_content = None
        config_data = None
        if config_path:
            config_content = ""
            config_data = config_form_data({})
        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config_content = f.read()
                config_data = config_form_data(yaml.safe_load(config_content) if config_content.strip() else {})
            except Exception as e:
                logger.warning(f"Could not read config file: {e}")

        return {"configPath": config_path or None, "configContent": config_content, "configData": config_data}

    def _list_files_in_directory(self, directory, file_type):
        """Helper to list files in a directory with metadata.

        Args:
            directory: Directory path to list
            file_type: Type label for files (e.g., "log", "csv")

        Returns:
            List of file dictionaries with name, size, modified, type (sorted by modified)
        """
        files = []
        if os.path.exists(directory):
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                if os.path.isfile(file_path):
                    stat = os.stat(file_path)
                    files.append(
                        {
                            "name": filename,
                            "size": stat.st_size,
                            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "type": file_type,
                        }
                    )
        # Sort files by modified date (newest first)
        files.sort(key=lambda x: x["modified"], reverse=True)
        return files

    @admin_auth_required
    async def files_list(self, request):
        """List all files in logs_dir, csv_dir, and quizzes_dir with metadata.

        Returns:
            JSON response with logs, csv, and quizzes file lists
        """
        logs_files = self._list_files_in_directory(self.logs_dir, "log")
        csv_files = self._list_files_in_directory(self.csv_dir, "csv")
        quizzes_files = self._list_files_in_directory(self.quizzes_dir, "yaml")

        return web.json_response({"logs": logs_files, "csv": csv_files, "quizzes": quizzes_files})

    def _get_file_path_and_validate(self, file_type, filename):
        """Helper to validate file type, filename, and return file path.

        Prevents path traversal attacks and validates file existence.

        Args:
            file_type: Type of file ("csv", "logs", or "quizzes")
            filename: Name of the file

        Returns:
            Tuple of (file_path, error_response) where error_response is None on success
        """
        # Determine base directory from file type
        if file_type == "csv":
            base_dir = self.csv_dir
        elif file_type == "logs":
            base_dir = self.logs_dir
        elif file_type == "quizzes":
            base_dir = self.quizzes_dir
        else:
            return None, web.json_response({"error": self._t("invalid_file_type")}, status=400)

        # Validate filename (prevent path traversal)
        if not self._is_safe_filename(filename):
            return None, web.json_response({"error": self._t("invalid_filename")}, status=400)

        file_path = os.path.join(base_dir, filename)

        # Check if file exists
        if not os.path.exists(file_path):
            return None, web.json_response({"error": self._t("file_not_found")}, status=404)

        # Check if it's actually a file (not directory)
        if not os.path.isfile(file_path):
            return None, web.json_response({"error": self._t("not_a_file")}, status=400)

        return file_path, None

    @admin_auth_required
    async def files_view(self, request):
        """View file contents (text files only, with 10MB size limit).

        Args:
            request: aiohttp request with type and filename in path

        Returns:
            Plain text response with file content or error if too large/binary
        """
        file_type = request.match_info["type"]
        filename = request.match_info["filename"]

        # Validate and get file path
        file_path, error = self._get_file_path_and_validate(file_type, filename)
        if error:
            return error

        # Check file size (limit to 10MB for viewing)
        MAX_VIEW_SIZE = 1024 * 1024 * 10  # 10MB
        file_size = os.path.getsize(file_path)

        if file_size > MAX_VIEW_SIZE:
            return web.json_response(
                {
                    "error": self._t("file_too_large", size=file_size),
                    "size": file_size,
                },
                status=400,
            )

        # Read file content
        try:
            async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
                content = await f.read()
        except UnicodeDecodeError:
            return web.json_response({"error": self._t("file_not_utf8")}, status=400)

        return web.Response(
            text=content, content_type="text/plain", headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )

    @admin_auth_required
    async def files_download(self, request):
        """Download file directly.

        Args:
            request: aiohttp request with type and filename in path

        Returns:
            File response with appropriate content-type and disposition headers
        """
        file_type = request.match_info["type"]
        filename = request.match_info["filename"]

        # Validate and get file path
        file_path, error = self._get_file_path_and_validate(file_type, filename)
        if error:
            return error

        # Determine content type
        if file_type == "csv":
            content_type = "text/csv"
        elif file_type == "quizzes":
            content_type = "text/yaml"
        else:
            content_type = "text/plain"

        # Return file response with proper headers
        return web.FileResponse(
            file_path,
            headers={"Content-Disposition": f'attachment; filename="{filename}"', "Content-Type": content_type},
        )

    @admin_auth_required
    async def files_save_quiz(self, request):
        """Save quiz file with validation and backup.

        Args:
            request: aiohttp request with filename in path and content in body

        Returns:
            JSON response with success status and backup filename
        """
        filename = request.match_info["filename"]
        data = await request.json()
        content = data.get("content", "").strip()

        if not content:
            return web.json_response({"error": self._t("content_required")}, status=400)

        # Validate filename
        if not self._is_safe_filename(filename):
            return web.json_response({"error": self._t("invalid_filename")}, status=400)

        quiz_path = os.path.join(self.quizzes_dir, filename)

        if not os.path.exists(quiz_path):
            return web.json_response({"error": self._t("quiz_not_found")}, status=404)

        # Validate YAML
        try:
            parsed = yaml.safe_load(content)
            errors = []
            if not self._validate_quiz_data(parsed, errors):
                return web.json_response({"error": self._t("invalid_quiz_structure"), "errors": errors}, status=400)
        except yaml.YAMLError as e:
            return web.json_response({"error": self._t("invalid_yaml", error=str(e))}, status=400)

        # Create backup
        backup_path = quiz_path + ".backup"

        shutil.copy2(quiz_path, backup_path)

        # Write the updated content with fsync for SD card/slow storage reliability
        async with aiofiles.open(quiz_path, "w", encoding="utf-8") as f:
            await f.write(content)
            await f.flush()
            os.fsync(f.fileno())

        # If this is the currently active quiz, reload it
        if filename == self.current_quiz_file:
            logger.info(f"Reloading active quiz after edit: {filename}")
            await self.load_questions()

        logger.info(f"Saved quiz file: {filename}")
        return web.json_response(
            {
                "success": True,
                "message": self._t("quiz_saved_backup", name=filename),
                "backup": backup_path,
            }
        )

    def _is_safe_filename(self, filename):
        """Check if filename is safe (no path traversal attempts).

        Validates against path traversal, null bytes, special names, and length.

        Args:
            filename: Filename to validate

        Returns:
            True if safe, False otherwise
        """
        if not filename:
            return False

        # Check for path traversal attempts
        if ".." in filename or "/" in filename or "\\" in filename:
            return False

        # Check for null bytes
        if "\0" in filename:
            return False

        # Check for special filenames
        if filename in [".", ".."]:
            return False

        # Check for overly long filenames
        if len(filename) > 255:
            return False

        return True

    async def serve_index_page(self, request):
        """Serve the index.html page from static directory.

        Returns:
            HTML file response
        """
        index_path = f"{self.static_dir}/index.html"
        # The page embeds the quiz, so the browser must check for a newer one instead of using its cache
        return web.FileResponse(
            index_path, headers={"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache"}
        )

    async def get_quiz_version(self, request):
        """Return the current quiz version; open quiz pages poll it to reload after a quiz switch."""
        return web.json_response({"quiz_version": self.quiz_version}, headers={"Cache-Control": "no-store"})

    def stale_quiz_response(self, request):
        """Return a 409 response when a student request comes from a page of another quiz, else None.

        The quiz page sends ``quiz_version`` with every API request. After a quiz switch or a
        restart the page still shows the old questions; answering them would store answers for
        the new quiz's questions, so the request is refused and the page reloads.
        """
        client_version = request.query.get("quiz_version")
        if client_version is None or not request.path.startswith(STUDENT_API_PATHS):
            return None
        if client_version == self.quiz_version:
            return None
        logger.info(f"Request {request.path} from a page of another quiz version ({client_version}), asking to reload")
        return web.json_response(
            {"error": self.translations["quiz_changed"], "quiz_changed": True, "quiz_version": self.quiz_version},
            status=409,
        )

    @local_network_only
    async def serve_admin_page(self, request):
        """Serve the admin app (one page for /admin/, its sections /admin/{section} and /files/).

        Injects trusted IP status, network info, downloadable quizzes, config content and version.

        Returns:
            HTML response with admin interface
        """
        # Check if client IP is trusted (its requests pass without a session)
        client_ip = get_client_ip(request)
        is_trusted_ip = client_ip in self.admin_config.trusted_ips if hasattr(self, "admin_config") else False

        # Get network information (external interfaces only)
        interfaces = get_network_interfaces(include_ipv6=self.config.server.include_ipv6)
        port = self.config.server.port
        url_format = self.config.server.url_format

        # URLs for external network interfaces only
        urls = [normalize_url(url_format.replace("{IP}", ip).replace("{PORT}", str(port))) for ip in interfaces]

        # Get downloadable quizzes configuration
        downloadable_quizzes = []
        if hasattr(self.config, "quizzes") and self.config.quizzes and self.config.quizzes.quizzes:
            for quiz in self.config.quizzes.quizzes:
                downloadable_quizzes.append(
                    {"name": quiz.name, "download_path": quiz.download_path, "folder": quiz.folder}
                )

        # Read SSH public key if tunnel is configured
        tunnel_public_key = ""
        if self.tunnel_manager and self.tunnel_manager.config and self.tunnel_manager.config.public_key:
            try:
                public_key_path = self.tunnel_manager.config.public_key

                # Resolve path relative to binary directory if needed
                if not os.path.isabs(public_key_path):
                    binary_dir = os.environ.get("WEBQUIZ_BINARY_DIR")
                    if binary_dir:
                        public_key_path = os.path.join(binary_dir, public_key_path)

                if os.path.exists(public_key_path):
                    with open(public_key_path, "r") as f:
                        tunnel_public_key = f.read().strip()
            except Exception as e:
                logger.error(f"Error reading tunnel public key: {e}")

        page = {
            "isTrustedIp": is_trusted_ip,
            "networkUrls": urls,
            "downloadableQuizzes": downloadable_quizzes,
            "tunnelPublicKey": tunnel_public_key,
            **self._config_page_data(),
        }
        return render_ui_page(self.templates.get("ui/admin.html"), self._ui_page_data(page))

    @local_network_only
    async def serve_live_stats_page(self, request):
        """Serve the live stats page.

        Returns:
            HTML response with live stats interface
        """
        return render_ui_page(self.templates.get("ui/live-stats.html"), self._ui_page_data())

    async def _handle_websocket_connection(
        self, request, client_list: List[web.WebSocketResponse], initial_state_data: dict, client_type: str
    ):
        """Generic WebSocket connection handler.

        Manages connection lifecycle: adds to list, sends initial state,
        handles messages, removes on disconnect.

        Args:
            request: aiohttp request object
            client_list: List to manage connected clients
            initial_state_data: Initial data to send on connection
            client_type: Description for logging

        Returns:
            WebSocket response object
        """
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        # Add to connected clients
        client_list.append(ws)
        logger.info(f"New {client_type} client connected. Total clients: {len(client_list)}")

        # Send initial state
        try:
            await ws.send_str(json.dumps(initial_state_data))
        except Exception as e:
            logger.error(f"Error sending initial state to {client_type} client: {e}")

        # Listen for messages (mainly for connection keep-alive)
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    if data.get("type") == "ping":
                        await ws.send_str(json.dumps({"type": "pong"}))
                except Exception as e:
                    logger.warning(f"Error processing {client_type} message: {e}")
            elif msg.type == WSMsgType.ERROR:
                logger.error(f"{client_type} error: {ws.exception()}")
                break

        # Remove from connected clients when connection closes
        if ws in client_list:
            client_list.remove(ws)
        logger.info(f"{client_type} client disconnected. Total clients: {len(client_list)}")

        return ws

    @local_network_only
    async def websocket_live_stats(self, request):
        """WebSocket endpoint for live stats updates.

        Filters to only show approved users in live stats.

        Returns:
            WebSocket connection with live stats updates
        """
        # Filter out unapproved users from live stats
        approved_users = {
            user_id: user_data["username"]
            for user_id, user_data in self.users.items()
            if user_data.get("approved", True)  # Include if approved or no approval field (backward compatibility)
        }

        # Filter live stats to only include approved users
        approved_live_stats = {
            user_id: stats for user_id, stats in self.live_stats.items() if user_id in approved_users
        }

        # Build completion status for approved users
        completed_users = {
            user_id: (len(self.user_answers.get(user_id, [])) == len(self.questions))
            for user_id in approved_users.keys()
        }

        # Build completion timestamps for approved users
        completion_times = {
            user_id: self.user_stats.get(user_id, {}).get("completed_at").strftime("%d.%m.%Y %H:%M:%S")
            for user_id in approved_users.keys()
            if user_id in self.user_stats
        }

        initial_data = {
            "type": "initial_state",
            "live_stats": approved_live_stats,
            "users": approved_users,
            "completed_users": completed_users,
            "completion_times": completion_times,
            "questions": self.questions,
            "total_questions": len(self.questions),
            "total_points": sum_points(q.get("points", 1) for q in self.questions),
            "current_quiz": self._current_quiz_name(),
        }
        return await self._handle_websocket_connection(request, self.websocket_clients, initial_data, "WebSocket")

    @local_network_only
    async def websocket_admin(self, request):
        """WebSocket endpoint for admin real-time notifications.

        Sends notifications for user registrations awaiting approval.

        Returns:
            WebSocket connection with admin notifications
        """
        # Filter users waiting for approval and extract only registration fields
        pending_users = {}
        if hasattr(self.config, "registration") and self.config.registration.approve:
            for user_id, user_data in self.users.items():
                if not user_data.get("approved", True):
                    pending_users[user_id] = {
                        "username": user_data["username"],
                        "registration_fields": self._extract_registration_fields(user_data),
                    }

        # Get tunnel status if configured
        tunnel_info = None
        if self.tunnel_manager:
            tunnel_status = self.tunnel_manager.get_status()
            tunnel_info = {
                "configured": True,
                "server": self.config.tunnel.server,
                "socket_name": self.config.tunnel.socket_name,
                **tunnel_status,
            }

        initial_data = {
            "type": "initial_state",
            "pending_users": pending_users,
            "requires_approval": hasattr(self.config, "registration") and self.config.registration.approve,
            "tunnel": tunnel_info,
            "transfer_requests": self.transfer.list_incoming(),
            "quiz": self._admin_quiz_info(),
            "users": [self._admin_user_record(user_id) for user_id in self.users],
        }
        return await self._handle_websocket_connection(
            request, self.admin_websocket_clients, initial_data, "admin WebSocket"
        )


async def create_app(config: WebQuizConfig):
    """Create and configure the application"""

    server = TestingServer(config)

    # Initialize log file first (this will set server.log_file)
    await server.initialize_log_file()

    # Configure logging with the actual log file path
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.FileHandler(server.log_file), logging.StreamHandler()],  # Also log to console
        force=True,  # Override any existing configuration
    )

    # Log startup environment information for troubleshooting
    log_startup_environment(config)

    # Initialize SSH tunnel if configured (checks keys, but doesn't auto-connect)
    await server.initialize_tunnel()

    # Load questions and create HTML with embedded data (CSV will be initialized in switch_quiz)
    await server.load_questions()

    # Start periodic flush task
    asyncio.create_task(server.periodic_flush())

    @web.middleware
    async def quiz_version_middleware(request, handler):
        stale = server.stale_quiz_response(request)
        if stale is not None:
            return stale
        return await handler(request)

    # Create app with middleware
    app = web.Application(middlewares=[error_middleware, quiz_version_middleware])

    # Routes
    app.router.add_post("/api/register", server.register_user)
    app.router.add_put("/api/update-registration", server.update_registration)
    app.router.add_post("/api/submit-answer", server.submit_answer)
    app.router.add_post("/api/skip-question", server.skip_question)
    app.router.add_post("/api/question-start", server.question_start)
    app.router.add_get("/api/verify-user/{user_id}", server.verify_user_id)
    app.router.add_post("/api/finish-test", server.finish_test)
    app.router.add_get("/api/quiz-version", server.get_quiz_version)

    # Admin routes
    app.router.add_get("/admin/", server.serve_admin_page)
    app.router.add_post("/api/admin/auth", server.admin_auth)
    app.router.add_get("/api/admin/check-session", server.admin_check_session)
    app.router.add_get("/api/admin/version-check", server.admin_version_check)
    app.router.add_put("/api/admin/approve-user", server.admin_approve_user)
    app.router.add_post("/api/admin/force-show-answers", server.admin_force_show_answers)
    app.router.add_get("/api/admin/list-quizzes", server.admin_list_quizzes)
    app.router.add_post("/api/admin/switch-quiz", server.admin_switch_quiz)
    app.router.add_get("/api/admin/quiz/{filename}", server.admin_get_quiz)
    app.router.add_post("/api/admin/create-quiz", server.admin_create_quiz)
    app.router.add_put("/api/admin/quiz/{filename}", server.admin_update_quiz)
    app.router.add_delete("/api/admin/quiz/{filename}", server.admin_delete_quiz)
    app.router.add_post("/api/admin/unite-quizzes", server.admin_unite_quizzes)
    app.router.add_post("/api/admin/validate-quiz", server.admin_validate_quiz)
    app.router.add_get("/api/admin/list-images", server.admin_list_images)
    app.router.add_get("/api/admin/list-files", server.admin_list_files)
    app.router.add_get("/api/admin/list-checker-templates", server.admin_list_checker_templates)
    app.router.add_post("/api/admin/download-quiz", server.admin_download_quiz)
    app.router.add_put("/api/admin/config", server.admin_update_config)

    # Tunnel routes
    app.router.add_post("/api/admin/tunnel/connect", server.tunnel_connect)
    app.router.add_post("/api/admin/tunnel/disconnect", server.tunnel_disconnect)

    # File transfer between servers on the same tunnel server
    app.router.add_get("/api/admin/transfer", server.admin_transfer_state)
    app.router.add_post("/api/admin/transfer/send", server.admin_transfer_send)
    app.router.add_post("/api/admin/transfer/{request_id}/accept", server.admin_transfer_accept)
    app.router.add_post("/api/admin/transfer/{request_id}/reject", server.admin_transfer_reject)
    # Called by other servers through the tunnel (protected by the offer token, not by IP)
    app.router.add_post("/api/transfer/offer", server.transfer.handle_offer)
    app.router.add_get("/api/transfer/download/{token}/{type}/{filename}", server.transfer.handle_download)
    app.router.add_post("/api/transfer/result", server.transfer.handle_result)

    app.router.add_get("/ws/admin", server.websocket_admin)

    # File management routes (admin access)
    app.router.add_get("/admin/{section:.+}", server.serve_admin_page)
    # The file manager is a section of the admin app now; the old URL opens it
    app.router.add_get("/files/", server.serve_admin_page)
    # Quiz file attachment download route
    app.router.add_get("/attach/{filename}", server.serve_quiz_file)
    app.router.add_get("/api/files/list", server.files_list)
    app.router.add_get("/api/files/{type}/view/{filename}", server.files_view)
    app.router.add_get("/api/files/{type}/download/{filename}", server.files_download)
    app.router.add_put("/api/files/quizzes/save/{filename}", server.files_save_quiz)

    # Live stats routes (public access)
    app.router.add_get("/live-stats/", server.serve_live_stats_page)
    app.router.add_get("/ws/live-stats", server.websocket_live_stats)

    # Serve index.html at root path
    app.router.add_get("/", server.serve_index_page)

    # Ensure imgs and attach directories exist
    ensure_directory_exists(os.path.join(config.paths.quizzes_dir, "imgs"))
    ensure_directory_exists(os.path.join(config.paths.quizzes_dir, "attach"))
    app.router.add_static(
        "/imgs/",
        path=os.path.join(config.paths.quizzes_dir, "imgs"),
        show_index=True,
        name="imgs",
    )
    # Assets of the pages built from frontend/ (file names carry a content hash)
    if UI_DIR.is_dir():
        app.router.add_static("/ui/", path=UI_DIR, name="ui")
    else:
        logger.warning(f"Frontend build not found at {UI_DIR}; run `npm ci && npm run build` in frontend/")
    # Serve static files from configured static directory
    app.router.add_static("/", path=config.paths.static_dir, name="static")

    return app

# CLAUDE.md

## ⚠️ CRITICAL: Every Code Change MUST Include

1. **Update CLAUDE.md** - Reflect architectural changes, new features, API endpoints, technical decisions. Keep this file MINIMAL - detailed user-facing info belongs in README.md
2. **Update README.md** - User-facing documentation with detailed usage instructions
3. **Update docs/** - Both Ukrainian (`docs/uk/`) and English (`docs/en/`) in sync
4. **Write tests FIRST** - All functionality requires automated tests (update test counts below)
5. **Mobile support** - All UI must be responsive (≤768px viewport, `width: 100%; max-width: [size]`)

---

## Project Overview
WebQuiz - Python/aiohttp quiz system with multi-quiz management, real-time WebSocket stats, admin approval workflow, and question randomization.

## Architecture
- **Backend**: aiohttp + middleware + WebSocket
- **Frontend**: React 19 + TypeScript + Ant Design 6 in `frontend/`, built by Vite into `webquiz/ui/` (mobile-responsive ≤768px). The user quiz page uses antd too (same theme as the admin pages, `motion: false`)
- **Storage**: In-memory → CSV (5s flush) in a per-run archive folder, YAML configs, quiz state resets on switch
- **Auth**: Session cookies for admin (master key at login), automatic local network restriction
- **Testing**: Integration + unit test

## Key Files
- `webquiz/server.py` - Main aiohttp server
- `webquiz/config.py` - Configuration dataclasses and loading functions
- `webquiz/translations.py` - UI and error message translations (uk/en)
- `webquiz/tunnel.py` - SSH tunnel manager for public access
- `webquiz/transfer.py` - File transfer between servers on the same tunnel server
- `webquiz/archive.py` - Quiz run archive: run folders, summary.json, per-run log handler, zip/unzip of a run for transfer
- `webquiz/cli.py` - CLI with daemon support
- `webquiz/build.py` - PyInstaller build script
- `installer/webquiz.iss` - Inno Setup script for Windows installer
- `frontend/` - Vite multi-page app: `quiz.html`, `admin.html` + `src/{quiz,admin,files,shared}`; Vitest tests next to the code (`*.test.ts`). `admin.html` is the whole admin app (`src/admin/AdminApp.tsx`), `src/files/` holds its Archive/Settings sections
- `webquiz/ui/` - built pages (git-ignored, shipped in the wheel and the binary)
- `webquiz/templates/` - quiz_selection_required.html, template_error.html (small server-rendered pages)
- `tests/` - Test suite
- `docs/uk/`, `docs/en/` - Documentation (compiled to PDF with version)
- `gh-pages/index.html` - GitHub Pages download page template (version placeholder: `{{VERSION}}`)
- `gh-pages/docs/` - Docsify config files for online documentation (en/, uk/)

## API Endpoints

**Public:**
- `POST /api/register` (optional `registration_token`: a repeat with the same token returns the existing user), `PUT /api/update-registration` (only before approval; a missing key keeps the value, an empty name/field → 400; on the quiz page a click on the name (edit icon) opens the dialog while waiting; it closes by itself when the test starts), `POST /api/submit-answer` (repeat with the same answer returns the stored result; a different answer to an answered question, including a timeout placeholder → 409; questions may be answered in any order), `POST /api/skip-question` (403 unless `allow_skip_questions`; 409 for an answered question), `GET /api/quiz-version` (`{quiz_version}`, polled by open quiz pages), `POST /api/finish-test` (`{user_id, reason?}`; fills unanswered questions with wrong placeholders; no-op for a completed test; 400 before the test started), `POST /api/question-start` (ignored for an answered question; restarts timing when the shown question changes), `GET /api/verify-user/{user_id}` (also returns `time_limit`, `remaining_seconds`, `allow_skip_questions`, `answered_questions` {id: raw answer}, `skipped_questions` so the page restores its state after a reload; finishes a test whose time ran out). Submit/skip after the time limit + `TIME_LIMIT_GRACE_SECONDS` → 409 with `time_is_up: true` and the test is finished
- `GET /attach/{filename}` - Download quiz file attachment (Content-Disposition: attachment)

**Admin (session cookie required, local network only):**
- `POST /api/admin/auth` - Authenticate with master key in request body (`{"master_key": "..."}`)
- `GET /api/admin/check-session`, `GET /api/admin/version-check`, `PUT /api/admin/approve-user`, `POST /api/admin/force-show-answers`, `GET /api/admin/list-quizzes`, `POST /api/admin/switch-quiz`, `PUT /api/admin/config` (accepts `{content: yaml}` or `{data: {section: {...}}}` for JSON partial update; response includes `config_content` and `config_data`)
- Quiz management: `GET /api/admin/quiz/{filename}`, `POST /api/admin/create-folder` (`{folder: "a/b"}` → `{folder: "a/b/"}`, parents created; 400 for `..`, absolute, Windows-invalid names, `imgs`/`attach` on top; 409 if it exists), `POST /api/admin/rename-folder` (`{folder: "a/b/", new_name: "c"}` → `a/c/`, same parent), `POST /api/admin/delete-folder` (`{folder}`, with everything inside, returns `deleted_quizzes`); both 400 for quizzes/ itself, 404 missing, 409 while the folder holds the active quiz, `POST /api/admin/create-quiz`, `PUT /api/admin/quiz/{filename}`, `DELETE /api/admin/quiz/{filename}`, `POST /api/admin/download-quiz`, `POST /api/admin/unite-quizzes`
- Quiz file attachments: `GET /api/admin/list-files` (list files in quizzes/attach/)
- Checker templates: `GET /api/admin/list-checker-templates` (list configured checker templates for text questions)
- Archive: `GET /api/admin/archive` (`{runs: [{name, quiz, title, started_at, total_questions, users, answers, correct_percent, avg_time_per_question, current, files: [{name, size}]}], current, left_columns}`, newest first; the current run has live numbers and is flushed first, so its CSV files are listed at once), `GET /api/admin/archive-zip/{run}` (all files of a run as `{run}.zip` from `archive.zip_run()`, the current run flushed first; "Download all files (zip)" in an expanded record), `GET /api/admin/archive/{run}/{filename}` (text, 10 MB max; `?download=1` as attachment, `?download=1&format=xlsx` converts a CSV to an Excel workbook with `archive.rows_to_xlsx()` (own minimal writer, no dependency; thin borders on every cell, bold centered header, no frozen pane (Excel draws its line past the table); cells are centered except the free-text columns from `_left_aligned_headers()`: name, registration fields, question and answer texts. The same list comes as `left_columns` with the archive list and aligns the CSV table view, whose headers are always centered); flushes the current run first; `run_files()` orders users ("Результати"), answers ("Детальні відповіді"), answers_with_users, other files, `server.log` last; the Archive page shows them as cards, 3 in a row, with readable names via `fileLabelKey()`)
- Quiz file download: `GET /api/admin/quiz-file/{filename}` (URL-encoded, subfolders allowed)
- Tunnel management: `POST /api/admin/tunnel/connect`, `POST /api/admin/tunnel/disconnect`
- File transfer: `GET /api/admin/transfer` (state: own name, sent offers, incoming requests), `POST /api/admin/transfer/send` (`{to, files: [{type, name}]}`), `POST /api/admin/transfer/{request_id}/accept` (optional `{files: [{type, name, action: save|replace|rename|skip, new_name}]}`; 400 keeps the request open), `POST /api/admin/transfer/{request_id}/reject`

**Server-to-server (through the tunnel, protected by the offer token, not by IP):**
- `POST /api/transfer/offer`, `GET /api/transfer/download/{token}/{type}/{filename}`, `POST /api/transfer/result`

**Admin Pages (local network only):**
- `GET /admin/`, `GET /admin/{section}` (`quizzes`, `archive`, `settings`, `access`), `GET /files/` (opens the archive) - the admin app (one page, `serve_admin_page`)

**WebSockets:**
- `WS /ws/admin` (local network only; `initial_state` has `quiz` (`_admin_quiz_info`) and `users` (`_admin_user_record` each); `user_updated` {user} on every change of a user (registration, update, approval, question start, answer, skip, finish); `quiz_switched` with the new `quiz` and `users: []`; plus `new_registration`, `user_approved`, tunnel status, `answers_forced` and file transfer notifications: `transfer_request`, `transfer_request_removed`, `transfer_result`)

## Dev Commands

⚠️ **ALWAYS use venv**: All Python commands and poetry operations must run inside virtual environment (`source venv/bin/activate` or `poetry shell`)

```bash
# Environment Setup (from scratch)
python3 -m venv venv           # Create virtual environment
source venv/bin/activate       # Activate venv
pip install poetry             # Install poetry inside venv
poetry install                 # Install project dependencies

# Quick Setup (if venv already exists)
source venv/bin/activate && poetry install

# Run
source venv/bin/activate && webquiz --master-key secret123
source venv/bin/activate && webquiz -d  # daemon

# Test
source venv/bin/activate && python -m pytest tests/ -v -n 4

# Test with coverage (subprocess tracking enabled, use pytest-cov)
source venv/bin/activate && python -m pytest tests/ -v --cov=webquiz --cov-report=html --cov-report=term-missing

# Note: Use pytest-cov (--cov) not "coverage run" for subprocess tracking

# Frontend (Node 20+): build before running the server or the Python tests
cd frontend && npm ci && npm run build   # into webquiz/ui/
cd frontend && npm test                  # Vitest
cd frontend && npm run dev               # :5173, proxies /api and /ws to WEBQUIZ_URL (default :8080)

# Build binary (current OS only, needs the frontend built)
source venv/bin/activate && poetry run build_binary
```

### Environment Requirements
- **Python**: 3.9+ (tested with 3.9-3.14)
- **Poetry**: Installed inside venv (not globally) to avoid conflicts
- **Test ports**: Tests use ports 8080-8087 for parallel execution (-n 4 uses 4 workers). CLI tests that launch a real server use 8090-8097 via `--port` so they never collide with fixture workers

## Stress Testing

**Note**: Stress testing moved to separate project: [webquiz-stress-test](https://github.com/oduvan/webquiz-stress-test)

```bash
# Install stress test tool
pip install webquiz-stress-test

# Run stress test
webquiz-stress-test -c 50
```

## Technical Decisions
- **Admin app (SPA)** - One page with a dark antd `Menu` header (like rafd_bermuda): Overview (current quiz card + live users table; an expanded row lists each question with the given and the correct answer: `answers` {id: [texts]} in `_admin_user_record` from `answer_results`, `correct_answer` [texts] per question in `_admin_quiz_info`, both built by `_answer_parts`), Quizzes (tree, download, send panel, incoming transfer requests; the transfer badge is on its menu item), Archive (`src/files/ArchivePage.tsx`: runs table, expandable files with view/download, send panel, "show records without users" switch; pure logic in `src/files/archive.ts`), Settings (only with a config file), Access. There is no live stats / projector page (removed with `/ws/live-stats`); per-question states (`live_stats` in `_admin_user_record`, `update_live_stats()`) feed the Overview only; state colors and labels are in `shared/questionState.ts`. Own tiny router (`src/admin/router.ts`, `history.pushState`, no react-router); the server serves `admin.html` for every section path and for `/files/` (and `/admin/files` → archive) with all page data (admin + `_config_page_data()`). Overview data comes only from `/ws/admin` (`notify_admin_user_updated()` sends `user_updated` on registration, update, approval, question start, answer, skip and finish); timers tick locally from `received_at`. Status: `pending` / `in_progress` / `completed` / `time_up` (`finish_reason == "timeout"` stored by `_finish_user_test`). Progress column: a summary bar with counts (`progressSummary()`), no per-question dots. Default order is registration order (`sortUsers`), "№" is a fixed number from `userNumbers()` (registration order over all users), so finishing a test neither moves the row nor renumbers anyone. Columns sort with `USER_SORTERS` / `fieldSorter()` (progress: answers, then correct answers; progress, points and grade sort descending first). Pure logic in `src/admin/overview.ts`. `html { overflow-y: scroll }` keeps the page from jumping (`scrollbar-gutter: stable` did not reserve the room in Chrome) (and `html body { width: auto !important }` undoes antd's modal scrollbar compensation). Quiz editor stays a modal
- **Frontend build** - Pages are built from `frontend/` into `webquiz/ui/` (`base: "/ui/"`, served by `add_static("/ui/")`); `pyproject.toml` `include` and `build.py` `--add-data` ship them, CI builds them with Node before tests/wheel/binaries. `_load_templates()` loads `ui/*.html` (`UI_PAGES`); `render_ui_page()`/`inject_page_data()` replace `<!--WEBQUIZ_DATA-->` with `window.__WEBQUIZ__ = {language, version, page}` (`<` escaped), 503 with build instructions if not built. The quiz page is written to `static/index.html` with relative `ui/` asset URLs (reverse proxy prefix) and an escaped `<title>`. `manualChunks`: `react` and `vendor` (antd and the other libraries), shared by all pages; bundle size is not a concern. The quiz page (antd `Card`, `Form`, `Tag`, `Progress`, `Result`, `Table`; answer options are own `div`s styled in `quiz.css`) keeps the old DOM ids/classes (`option_N` with `selected`/`feedback-*`/`disabled`, `submit-answer-btn`/`continue-btn`/`skip-question-btn` with `hidden`, `#registration`/`#results` sections with `hidden`, `.registration-field[data-field-name]`, `q-btn`, `results-table`, `#timer`, `#user-info`, ...) the Selenium tests use; registration labels are `<label>`s above the inputs, results are an antd `Table` (cards on phones)
- **Middleware-based error handling** for aiohttp
- **Configuration module separation** - config.py contains dataclasses for configuration (using standard dataclasses module with field(default_factory=...))
- **6 digits user ID** stored by user_id as key
- **Server-side timing** for accuracy (starts on admin approval if required)
- **Multi-file quiz system** in `quizzes/` dir, auto-created if missing
- **Session-based admin auth** - Master key sent in request body to `/api/admin/auth`, returns session cookie for subsequent requests (no header-based auth)
- **Config validation** with comprehensive structure/type checks before save
- **Quiz run archive** - `switch_quiz` (switch, restart, config save) calls `finish_run()` (flush CSVs + summary of the old run) and `start_run()`: a folder `{archive_dir}/YYYY-MM-DD-HHMMSS-{quiz path with / → _}` (`-2`, `-3` in the same second) with `answers.csv`, `users.csv`, optional `answers_with_users.csv`, `server.log` and `summary.json` (quiz, title, started_at, total_questions, users, answers, correct_percent among given answers, avg_time_per_question; written on change by the periodic flush). Logging goes through one `archive.run_log_handler` (root logger) that `start_run` points to the new run's `server.log`; records before the first run are buffered and land in the first run's log. `paths.logs_dir`/`csv_dir` and `--logs-dir`/`--csv-dir` are gone (`REMOVED_PATH_KEYS` in config.py are ignored with a warning); old `data/`/`logs/` folders are not migrated. Runs without users are hidden in the Archive table unless the switch is on
- **Quiz state reset** on switch for complete isolation
- **In-memory → CSV** with 5s periodic flush using CSV module (no test-specific flush endpoint)
- **Cookie-based session** persistence (user_id for quiz users, admin_session for admin authentication)
- **Admin session cookies** - Secure httponly cookies set on successful master key authentication, persisted across page refreshes and navigation between admin/files pages
- **Auto-advance UI** when `show_right_answer: false`
- **Mobile-first** with `width: 100%; max-width: [size]` and @media ≤768px
- **UTF-8 Content-Type** for Ukrainian/multilingual text support
- **Server-side question randomization** generated at registration, stored per-user as `question_order` array, client reorders via JS
- **Sticky question groups** - Questions with `stick_to_the_previous: true` stay adjacent during randomization. Groups are formed by consecutive sticky flags and shuffled as units. First question cannot be sticky (no previous to stick to). UI shows 🔗 indicator on collapsed questions.
- **Test completion detection** uses answer count (`len(user_answers[user_id])`) instead of question ID to support randomization
- **Multi-platform binaries** via GitHub Actions (macOS-13 Intel, macOS-14 ARM64, Linux, Windows)
- **Windows installer** - Inno Setup script (`installer/webquiz.iss`) builds `webquiz-windows-setup.exe` with Start Menu shortcut and Add/Remove Programs uninstaller. Built in CI alongside portable ZIP. Version injected via `/DMyAppVersion` flag.
- **Coverage excludes build tools**: build.py and binary_entry.py omitted from coverage (not runtime code)
- **Quiz editors** - The wizard (`QuizEditor`) plus a YAML editor in the Quizzes section (`QuizYamlEditor`, "Edit YAML": loads `GET /api/admin/quiz/{f}` content, validates with `POST /api/admin/validate-quiz`, saves with `PUT /api/admin/quiz/{f}` `{mode: "text", content}`, which keeps a `.backup` and returns `errors`). Quizzes can be downloaded from the Quizzes section. A new question starts with 4 empty options. `frontend/src/admin/quizForm.ts` converts YAML <-> form and keeps unknown quiz/question keys (`marks`, `default_mark`, ...) in `extra`, so a save never drops them; it also edits `allow_skip_questions` and `time_limit`. Text questions always get a `checker` key (empty = exact match)
- **Dynamic answer visibility** - `show_answers_on_completion: true` reveals correct answers only after all approved users complete, with automatic re-hiding when new users register. The results page polls `GET /api/verify-user/{id}` every 5 s while `all_completed` is false and replaces the results when it turns true (no reload button)
- **SSH Tunnel for public access** - Optional feature to expose local server via SSH reverse tunnel with Unix domain sockets
- **ED25519 SSH keys** - Auto-generated if missing, stored with binary-relative paths for PyInstaller compatibility
- **Tunnel auto-reconnect** - Exponential backoff (5s → 300s max), connection monitoring via asyncssh
- **asyncssh forward_remote_path_to_port** - Used for forwarding remote Unix socket to local TCP port (not forward_remote_path)
- **WebSocket tunnel status** - Real-time updates broadcast to admin clients, no polling needed
- **Admin-triggered connection** - No auto-connect on startup, admin clicks button to establish tunnel
- **Tunnel URL in access list** - Public tunnel URL automatically added to "URL для доступу з інших пристроїв:" list with green background when connected
- **IP address detection** - Automatically uses HTTP for IP addresses (IPv4/IPv6) and HTTPS for domain names when fetching tunnel_config.yaml
- **Client IP behind proxies** - `get_client_ip()` trusts `X-Forwarded-For` / `X-Real-IP` only when the TCP peer is loopback (local reverse proxy or the SSH tunnel, which forwards to 127.0.0.1) and takes the **last** `X-Forwarded-For` entry (the tunnel server's nginx uses `$proxy_add_x_forwarded_for`, so earlier entries come from the client). Direct LAN clients cannot spoof their IP with headers.
- **File transfer between servers** - "Ask first, then send" over the public tunnel URLs (`{base_url}/{socket_name}/...`); direct SSH stream-local connections are blocked by the tunnel server (`AllowTcpForwarding remote`). Sender keeps an offer with a random token (30 min lifetime) and POSTs the file list; receiver admin accepts; receiver downloads from `{its own base_url}/{sender}/` with the token and reports the result. Only `.yaml/.yml` quizzes, archive runs (type `archive`, name `<run>.zip`: `archive.zip_run()` builds a deterministic zip on the fly for size/SHA-256/download, the receiver unpacks it with `unzip_run()` into a temp folder and moves it in place; same/different is decided by the zip checksum of the local folder), plus images (`quizzes/imgs/`) and attachments (`quizzes/attach/`) referenced by offered quizzes (`image`, image `options`, `file`), added automatically by the sender; names without path or Windows-invalid characters; offer entries carry a SHA-256. Receiver shows per file a case (`new`, `same`, `different`, `in_use` = current run folder/active quiz from `get_files_in_use`) with allowed actions (save/replace/rename/skip) and a default (save/skip/rename/rename); target name is the original name; rename suggests the first free `{sender}_name`, `_2`, `_3` (runs: `{run}-{sender}`, `-2`, `-3`, so the date stays first). `_build_plan()` validates all choices before any download (400 keeps the request). Receiver downloads media first and rewrites references in received quizzes with ruamel round-trip when media got a new name. The send panel (Quizzes and Archive sections, `useTransfer()` polls every 5 s) is hidden until `GET /api/admin/transfer` reports `available`. State is in memory (`TransferManager`). `TunnelManager.get_public_endpoint()` returns `(base_url, socket_id)` while connected.
- **Local network restriction** - All admin functionality (API endpoints via @admin_auth_required, HTML pages, WebSockets) automatically restricted to private networks (RFC 1918: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) with no configuration needed
- **Quiz download folder validation** - Path traversal protection: blocks "..", absolute paths (Unix/Windows), normalizes paths, ensures extraction stays within quizzes directory; allows subfolder paths like "folder/subfolder/"
- **Clipboard API fallback** - Copy public key button uses modern navigator.clipboard API for HTTPS/localhost, falls back to document.execCommand() for non-secure contexts (HTTP over IP)
- **Package version check** - Admin panel periodically checks if package was updated while server is running by comparing in-memory version with file version; shows "Restart Required" banner when mismatch detected
- **Quiz file attachments** - Questions can have downloadable files via `file` field (e.g., `file: "data.xlsx"`). Files stored in `quizzes/attach/`, served at `/attach/{filename}` with `Content-Disposition: attachment` header for forced download. Server auto-prepends `/attach/` when serving to client. Admin panel has file picker modal for selecting files.
- **Startup environment logging** - On server start, logs comprehensive environment info for troubleshooting: WebQuiz version, Python version/executable, OS/platform info, aiohttp version, working directory, config file path, binary mode status, server/path/admin/registration/tunnel configuration, and network interfaces. Master key value is never logged (only True/False).
- **SD card/slow storage reliability** - All file writes (config, quizzes, CSV) use `flush()` + `os.fsync()` to ensure data is physically written to storage before returning success. Prevents data loss on Raspberry Pi and systems with SD cards or exFAT partitions when powered off shortly after save.
- **Config hot-reload** - When admin saves config via web form (`PUT /api/admin/config`), changes are applied immediately without server restart. Hot-reloadable: registration settings (approve, fields, username_label), admin.trusted_ips, downloadable quizzes list, tunnel config. Requires restart (security/stability): server host/port, paths, master_key - shows "restart required" message with specific config paths. Quiz always restarted (users/state cleared) on config save. Templates are reloaded on each config save. If applying changes fails, config file is automatically rolled back to previous state.
- **Multi-quiz selection** - Admin panel quiz list is an antd tree Table grouped by folders (`quizRoot()`/`buildQuizTree()` in `src/admin/quizTree.ts`: the top row is `quizzes` itself, key `folder:`; folder rows keyed `folder:<path>/` with `data-folder`, without checkboxes, empty folders from `folders` of list-quizzes too, collapsed until the admin opens them). A click on a folder selects it (`quiz-folder-selected`), a click on a quiz selects its folder; "New quiz" (`EditorTarget {mode: "create", folder}`) and "New folder" create in the selected folder, with a folder below quizzes/ selected (no quiz) Edit renames it and Delete deletes it (disabled when it holds the current quiz), Duplicate next to the original, Unite in the folder of the first quiz. File name fields take the name alone (`fileNameError()` in `quizForm.ts` rejects `/` and `\`); the editor shows the folder as the input addon and keeps it on rename with row checkboxes on quizzes (row click selects one, Ctrl/Cmd+click adds, double click edits). Single selection shows standard buttons (Switch, Edit, Duplicate, Delete). Multiple selection shows Unite button and Delete. Delete button disabled when current quiz is in selection.
- **Quiz list with titles and settings** - `GET /api/admin/list-quizzes` returns `folders` (every folder of quizzes/ except `imgs/`, `attach/`, `list_quiz_folders()`) and `quizzes`, objects with `filename`, `title` (null if none) and, when the file parses, `total_questions`, `total_points`, `time_limit`, `randomize_questions`, `allow_skip_questions`, `show_right_answer`, `show_answers_on_completion`, `show_final_list` (`_quiz_list_entry`). The Quizzes section shows them as columns and tags of non-default settings.
- **Quiz unite** - `POST /api/admin/unite-quizzes` combines multiple quizzes into one. Takes config (title, settings) from first quiz, combines all questions in order. Accepts `{quiz_filenames: [...], new_name: "..."}`, validates all quizzes exist and have valid structure, warns about duplicate questions, creates new quiz file with fsync.
- **Question points** - Each question can have a `points` field (default: 1). Points are tracked per-answer, accumulated in user stats, and displayed in the admin overview (earned/total format), final results, and users CSV. Questions worth anything other than 1 point show a trophy indicator in UI.
- **Decimal points** - `points` may be a decimal with at most 2 places (e.g. `0.5`, `1.25`); must be > 0. Validation applies to all question types (it used to run only for text questions). Server normalizes every points value and sum through `normalize_points()`/`sum_points()` in `server.py`, which round to 2 decimals and return an int when whole, so sums like 0.1+0.2 report as 0.3 and not 0.30000000000000004. Pages mirror this with `roundPoints()`/`formatPoints()` (`frontend/src/shared/points.ts`); the admin editor's points input is a plain `type=number step=0.01` input (antd InputNumber would round 0.255 on blur), and `pointsError()`/`quizErrors()` in `quizForm.ts` block a save with an error naming the question when a value is <= 0 or has more than 2 decimals.
- **Text input questions** - Questions with `checker` field are automatically detected as text input questions (no `type` field needed). Fields: `default_value` (initial textarea value), `correct_value` (shown when wrong), `checker` (Python code for validation). Checker code is validated for Python syntax on quiz save. Checker code runs in sandboxed environment with limited builtins (math functions, basic types) plus helper functions: `to_int(str)` - convert to integer, `distance(str)` - parse distance (supports "2km", "2000m", "2км"), `direction_angle(str)` - parse direction angle ("20-30" = 2030). If checker is empty, exact match with `correct_value` is used. Returns `checker_error` message on failure.
- **Checker templates** - Admin-configurable code templates for text question validation. Defined in config as `checker_templates: [{name: "...", code: "..."}]`. Templates available in admin quiz editor for quick insertion.
- **Light theme only (fork)** - No dark theme or theme toggle on any page; antd theme tokens in `frontend/src/shared/AppProvider.tsx` (all pages, the quiz page included).
- **Manual answer revelation** - Admin can click "Show Answers" button to force `all_students_completed()` to return true, triggering existing answer visibility logic. Button only visible when quiz has `show_answers_on_completion: true`. Affects all students who complete after button click (including new registrations). One-way action (cannot be undone until quiz switch). Endpoint: `POST /api/admin/force-show-answers` (admin-auth required). Flag `force_all_completed` resets on quiz switch.
- **Quiz renaming** - Admin can rename quizzes via editor modal. Backend renames physical file with validation. **Active quiz cannot be renamed** (must switch to different quiz first, returns 409 error). CSV files retain old quiz name prefix (historical data preservation). Prevents filename conflicts with 409 status code.
- **Student request retry** - Quiz page sends requests through `fetchWithRetry()` (`frontend/src/quiz/connection.ts`): network error, 15s timeout (AbortController) or 502/503/504 → retry after 1s, 2s, 4s, then every 5s, forever, with a `#connection-banner` (`T.connection_lost`). Other HTTP errors are returned to the caller as before. The answer is locked (`answerLocked`, textarea disabled) while it is sent, and submit awaits the pending question-start request so the server gets question-start before the answer. Page-load verification retries instead of falling back to the registration form. Server makes repeats safe: `answer_results[user_id][question_id]` stores `{selected_answer, response}` **before** the admin `user_updated` `await`, so a concurrent retry also gets the stored result; `registration_tokens[token] -> user_id` (client sends a random `registration_token`, built with `crypto.getRandomValues` because `randomUUID` needs a secure context). Both dicts are cleared in `reset_server_state()`.
- **Question text copy prevention** - Quiz questions have `user-select: none` CSS and a `copy` event handler on the question container to prevent students from copying question text. Text input fields for text questions remain selectable.
- **Show final list** - `show_final_list` quiz option (default: true) controls whether the question-by-question results table is displayed on the final screen. When false, only the score summary (e.g., "3/5 (60%)") is shown. Setting is loaded from YAML, injected as `showFinalList` page data, validated as boolean, and editable in admin quiz editor.
- **Question navigation (fork)** - Quiz page shows a numbered navigation bar (`#nav .q-btn`) when the quiz has `allow_skip_questions` or the server config has `question_navigation: true` (default false; `showNavigation()` in `quiz/logic.ts`, page data `questionNavigation`, hot-reloadable, Settings form checkbox); without it questions just go one after another; students may answer questions in any order (no server-side order check), each only once. `allow_skip_questions: true` shows a Skip/Next button; skipped ids are kept in `user_data["skipped_questions"]` and shown as `skip` in live stats.
- **Time limit (fork)** - `time_limit` (seconds, 0 = none). The page counts down to a local deadline built from the server's `remaining_seconds` (recomputed each tick, so throttled background timers do not add time); on timeout it calls `/api/finish-test`, which appends placeholder answers (`time_taken: -1`, not counted in `total_count` or `total_time`). The server enforces the limit itself (10 s grace). Completion time uses `quiz_start_time`/`quiz_finish_time` on the user.
- **Per-question timing** - `question_start_times` + `question_start_ids` track which question the running start time belongs to; an answer to another question gets `time_taken` 0.
- **Grades (fork)** - `marks: [{grade, min_score}]` (default 5/95, 4/80, 3/60) converts the points percentage into `mark` (rules with a non-numeric `min_score` are ignored); `default_mark` (default 2) applies below every rule. Shown on results and in the users CSV.
- **Localized CSV (fork)** - Answers and users CSV use Ukrainian headers, usernames instead of user ids, HH:MM:SS times and `\n` line endings. Quizzes are found recursively in `quizzes/` subfolders (except `imgs/`, `attach/`); quiz names are relative paths with forward slashes (`grade5/math.yaml`), URL-encoded in `/api/admin/quiz/{filename}`, and `_resolve_quiz_path` keeps every quiz path inside `quizzes_dir`. Create, rename and unite resolve the target through it too (400 for `..`/absolute names), accept `.yml` and create missing folders (`_ensure_parent_dir`).
- **Quiz version reload** - `quiz_version` (random hex) is regenerated by every `switch_quiz` (switch, restart, config save) and embedded in the quiz page. The page appends `?quiz_version=` to every student API request; `quiz_version_middleware` answers requests with another version on `STUDENT_API_PATHS` with 409 `{quiz_changed: true}` and the page reloads (a sessionStorage guard stops reload loops). Open pages also poll `/api/quiz-version` every 5 s. Requests without the parameter are accepted (API clients, tests). The quiz page is served with `Cache-Control: no-cache`; the quiz selection page polls until a quiz is selected.
- **Image preloading** - All quiz images (question images and image options) are preloaded immediately on page load. Uses `new Image()` to cache images in browser while user fills registration form. Images from options starting with `/` are detected as image paths. Ensures instant image display during quiz. A click on the question image opens an antd `Image` preview over the page (zoom, drag, rotate; imported as `ImagePreview` so it does not shadow the browser `Image`).
- **Pickers show the real folder** - `GET /api/admin/list-images` / `list-files` also return `directory` (absolute path of `quizzes/imgs` / `quizzes/attach`), shown in the empty picker hint.
- **CSV table view** - `FileViewerModal` gives every column a fixed width from `csvColumnWidths()` (`shared/format.ts`) with `tableLayout="fixed"`, so the fixed header and the body stay aligned. The modal is as wide as the table (`viewerWidth()`: at most 90% of the window, 1000px for text), can be dragged by its title and resized by the bottom right corner (own mouse handlers in `modalRender`; a resized body height goes to the table's `scroll.y`; the corner handle needs `pointer-events: auto`, antd turns them off on `.ant-modal` outside its content and the press would close the modal as a mask click).
- **Config form editor** - Admin Settings section has Form/YAML toggle. Form view provides structured editing for language (uk/en dropdown), the quiz page background (`appearance`) and registration config (approve, username_label, fields). `config_form_data()` builds the form data for the page and the save response. Form sends JSON partial updates via `PUT /api/admin/config` with `{data: {language: "...", section: {...}}}` format — backend merges into existing YAML config (top-level scalars like `language` and per-section dicts are both supported). YAML view remains for direct editing. Both views sync after save (response includes `config_content` and `config_data`). Switching views with unsaved changes triggers confirm dialog. The server injects `configData` (parsed) and `configContent` as page data.
- **Disabled registration fields** - `registration.disabled_fields` (list of strings, default: empty) keeps field names in the config without showing them on the registration form. Admin form view renders `fields` + `disabled_fields` as a single unified list with per-row checkboxes — toggling a checkbox moves the field between the two lists on save (no add/delete needed). Server-side registration ignores anything in `disabled_fields`; only `fields` is iterated when rendering the form, validating required fields, and writing CSV headers. Hot-reloadable.
- **Comment-preserving config save** - Partial JSON updates via `PUT /api/admin/config` use `ruamel.yaml` in round-trip mode to load and re-dump the config file, so user comments and blank lines between sections survive form-driven edits. PyYAML is still used for validation and for the `{content}` full-replacement path (which writes the user-supplied text verbatim).
- **Quiz interface language** - `language` config option (`"uk"` or `"en"`, default `"uk"`) controls all user-facing strings in quiz interface and API error messages. Translations stored in `webquiz/translations.py`. The quiz page gets the translations as page data (`translations`); CSS `content:` labels use CSS variables set from them. Admin pages (admin app, archive, settings) follow the same option: their texts are in `frontend/src/shared/i18n/{uk,en}.ts` (same keys, checked by `i18n.test.ts`), used through `t(key, params)` / `tn(key, count)` (`"plural.*"` texts hold the Intl.PluralRules forms separated by `|`); the language comes from the page data, so an open admin page switches after a reload. Server-side error messages use `self.translations["key"]` (quiz page) and `self._t(key, **params)` for the admin API, quiz/config validation, file transfer (`TransferManager(get_language=...)`) and tunnel status errors (`TunnelManager(get_language=...)`) — `ADMIN_TRANSLATIONS` in `translations.py`, not sent to the quiz page. Hot-reloadable — applied on config save (quiz restart regenerates template).

## Key Flows

**Quiz**: Load YAML → inject to HTML → register user → cookie session → submit answers → timing → validate → in-memory → CSV flush
**Approval**: Register → `approved: false` → wait → admin WebSocket notified → approve button → **timing starts** → student checks → quiz begins
**Randomization**: Load YAML → register → `random.shuffle()` → store `question_order` per-user → client receives array → JS reorders → persists across sessions
**Admin**: Switch quiz → reset all state (users, progress, responses) → new CSV → session isolation → `quiz_switched` to admin pages (new quiz, empty users)
**Tunnel**: Initialize → check/generate keys → admin clicks connect → fetch server config → create SSH connection → forward remote Unix socket to local port (forward_remote_path_to_port) → broadcast public URL via WebSocket → auto-reconnect on disconnect
**File Transfer**: Sender admin ticks quizzes or archive records → `POST /api/admin/transfer/send` → offer + token stored → `POST {base_url}/{target}/api/transfer/offer` → receiver broadcasts `transfer_request` to admin WebSocket → admin accepts → receiver GETs each file from `{base_url}/{sender}/api/transfer/download/{token}/...` into a temp file, renames to a free name → `POST .../api/transfer/result` → sender marks offer accepted/rejected/failed (Quizzes/Archive sections poll `GET /api/admin/transfer`)
**Startup**: Load config → create TestingServer → configure logging (`run_log_handler` buffers until the first run) → **log environment info** (version, Python, OS, config, paths, network) → initialize tunnel → load questions (first `switch_quiz` → first run folder, buffered log lines written there) → start periodic flush → register routes
**Config Hot-Reload**: Admin saves config → validate YAML → backup original config → write to file → reload config from file → detect restart-required changes (server, paths, master_key) → apply safe changes (registration, trusted_ips, quizzes, tunnel) → reload templates → disconnect tunnel if connected (admin can reconnect) → restart current quiz (reset users/state) → return message (either "saved and applied" or "restart required for: ..."). On failure: rollback config file to backup → return error
**Text Question Validation**: Submit text answer → check question type → if text: execute checker code in sandboxed env (restricted builtins + math + helper functions: to_int, distance, direction_angle) → if exception: answer incorrect + return error message → if no exception: answer correct. No checker: exact match with `correct_value`

**Setup**: Parallel testing with ports 8080-8087, `custom_webquiz_server` fixture auto-cleans directories, `conftest.py` for shared fixtures. `test_cli_directory_creation.py` spawns the CLI with `sys.executable` and a worker-specific port from 8090-8097 (`cli_test_port()`)

**Windows test notes**: test servers write output to `server_output_{port}.log` (never an unread `PIPE`: the small Windows pipe buffer fills and blocks the server); `conftest.py` resolves `localhost` to IPv4 only (refused `::1` costs ~2 s per request); after stopping a server the fixture waits for its port to close (the venv `python.exe` is a launcher, the real server is its child). Progress per test: `pytest -vv` (`addopts` has `-q`, so `-v` only cancels it). CSV files are opened with `newline=""` so line endings stay `\n` on Windows. From Git Bash run pytest with `PYTHONUTF8=1` (cp1251 stdout chokes on the emoji the CLI prints); the PyInstaller binary ignores `PYTHON*` variables, so `binary_entry.py` reconfigures stdout/stderr to UTF-8. Selenium on antd pages: `element.clear()` does not reach React-controlled inputs (use `clear_input()`), modals and messages animate in (`wait_for_modal()`, read `textContent`), `#results` exists hidden from the start (`wait_for_results()`)

## Important Notes
- **CSV files** (2 per run, 3 with `extra_answers_with_users_csv: true`), all in the run folder: `answers.csv` (per-answer submissions, first column "Дата і час" DD.MM.YYYY HH:MM:SS) + `users.csv` (one row per user: №, name, registration fields, grade, HH:MM:SS time, answers given, correct answers, total questions, start/finish time) + optional `answers_with_users.csv` (per-answer rows with `user_id`, `username`, and registration fields prepended).
- **Config** (`webquiz.yaml`): All sections optional, editable in the admin Settings section, hot-reloaded on save (returns `restart_required` list if server/paths/master_key changed), UTF-8 charset header
- **Config options**:
  - `paths.archive_dir` - Folder of the quiz run archive (default `archive`, CLI `--archive-dir`); restart required
  - `language: en` - Language of the quiz interface, the admin pages and all error messages, `"uk"` (Ukrainian, default) or `"en"` (English). Hot-reloadable.
  - `question_navigation: true` - Question navigation bar on the quiz page for quizzes without `allow_skip_questions` (default: false). Hot-reloadable.
  - `extra_answers_with_users_csv: true` - Generate an additional **third** CSV (`{quiz}_{NNNN}.answers_with_users.csv`) with one row per submitted answer, prefixed by `user_id`, `username`, and registration field columns (default: false). The `extra_` prefix highlights that it is generated alongside the standard answers + users CSVs; the `answers_with_users` part names exactly what is combined. Useful for downstream analysis where you want answers and user attributes joined. Hot-reloadable (takes effect on next quiz switch / quiz restart).
  - `server.port` - Port the server listens on (default: 8080). CLI `--port` overrides it
  - `server.include_ipv6: true` - Include IPv6 addresses in network interfaces list (default: false)
  - `server.url_format` - URL format for admin panel network access URLs (default: `http://{IP}:{PORT}/`). Placeholders: `{IP}`, `{PORT}`. Example for reverse proxy: `http://{IP}/webquiz/`
  - `registration.approve: true` - Admin approval required, timing starts on approval (default: false)
  - `registration.username_label` - Customize username field label (default: empty = falls back to language translation, "Ім'я користувача" for uk / "Username" for en)
  - `registration.fields` - List of additional registration fields shown to users (default: empty)
  - `registration.disabled_fields` - List of additional registration fields preserved in the config but hidden from the registration form (default: empty). Admin form view toggles fields between `fields` and `disabled_fields` via per-row checkboxes — useful when admins frequently switch fields on/off without losing their names.
  - `appearance.background_color` - Hex color (`#rgb`/`#rrggbb`) of the user quiz page background (default dark `#1f2937`). `appearance.background_image` - image over the whole page instead (`/imgs/...` from `quizzes/imgs/` or a URL; empty = color only). Validated in `_validate_config_data`, edited in the admin Settings form (color picker / image picker + preview), hot-reloadable (page data `background: {color, image}`, applied to `body` by `frontend/src/quiz/main.tsx` via `shared/background.ts`; the built-in `img/background.png` is gone)
  - `randomize_questions: true` - Per-student random order, stored as `question_order` array (default: false)
  - `show_right_answer: false` - Auto-advance without continue button (seamless flow)
  - `show_answers_on_completion: true` - Reveal correct answers dynamically after all approved users complete; the waiting results page updates by itself (default: false)
  - `show_final_list: false` - Hide the list of questions with answers on the results screen, showing only the score summary (default: true)
  - `tunnel.server` - SSH tunnel server hostname (e.g., "tunnel.example.com")
  - `tunnel.public_key` - Path to SSH public key file (auto-generated if missing)
  - `tunnel.private_key` - Path to SSH private key file (auto-generated if missing)
  - `tunnel.socket_name` - Optional fixed socket name instead of random generation (default: random 6-8 hex chars). Needed for file transfer (other servers address this one by it). After a disconnect the name can stay busy up to 5 min (stale socket file until the tunnel server's cleanup cron)
  - `tunnel.config` - Optional nested config subsection (username, socket_directory, base_url) - bypasses server fetch when provided
- Questions use **0-indexed** `correct_answer` field and optional `points` field (default: 1)
- Text questions are detected by `checker` field (no `type` field needed, no `options` or `correct_answer`)
- `checker_templates` - List of `{name, code}` objects for admin panel template dropdown
- Usernames unique per quiz session
- Switching quizzes = full state reset

## Release
**Trigger**: GitHub Actions → "Release and Deploy to PyPI" → Enter version (X.Y.Z)

**Process**: Build frontend (Node 22, `npm ci && npm run build`) → Build binaries (Linux, macOS Intel/ARM64, Windows) → Build Windows installer (Inno Setup) → Update versions → Generate PDFs (uk/en) → Publish to PyPI → Create GitHub release with 9 assets (2 Python packages + 4 zipped binaries + 1 Windows installer + 2 PDFs) → Deploy GitHub Pages

**Note**: macOS builds on separate runners (macos-15-intel Intel, macos-15 ARM64)

**GitHub Pages**: https://oduvan.github.io/webquiz/ - Static site with download page and online documentation
- `deploy-pages.yml` - Manual trigger or called by release.yml (no auto-deploy on commit)
- Documentation uses Docsify (no build step, renders markdown on-the-fly)
- Docsify config in `gh-pages/docs/` with `_sidebar.md` for navigation

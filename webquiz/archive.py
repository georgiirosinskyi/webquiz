"""Quiz run archive.

Every quiz switch or restart starts a run: a folder in ``paths.archive_dir`` named
``YYYY-MM-DD-HHMMSS-<quiz>`` that holds the run's CSV files, its log and ``summary.json``
(numbers for the Archive section of the admin app).
"""

import csv
import io
import json
import logging
import os
import re
import zipfile
from collections import deque
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

ANSWERS_CSV = "answers.csv"
USERS_CSV = "users.csv"
ANSWERS_WITH_USERS_CSV = "answers_with_users.csv"
LOG_FILE = "server.log"
SUMMARY_FILE = "summary.json"

RUN_NAME_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{6}-[^/\\]+$")
# Run folder files: plain names, no hidden files and no characters Windows does not allow
FILE_NAME_PATTERN = re.compile(r'^[^./\\<>:"|?*\x00-\x1f][^/\\<>:"|?*\x00-\x1f]{0,254}$')

LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"


def is_valid_run_name(name: Any) -> bool:
    return isinstance(name, str) and len(name) <= 255 and ".." not in name and bool(RUN_NAME_PATTERN.match(name))


def is_valid_file_name(name: Any) -> bool:
    return isinstance(name, str) and ".." not in name and bool(FILE_NAME_PATTERN.match(name))


def run_folder_name(quiz_filename: str, now: datetime) -> str:
    """"grade5/math.yaml" at 2026-10-15 14:30:05 -> "2026-10-15-143005-grade5_math"."""
    stem = re.sub(r"\.ya?ml$", "", quiz_filename)
    stem = re.sub(r'[/\\<>:"|?*\x00-\x1f]', "_", stem).strip(". ") or "quiz"
    return f"{now:%Y-%m-%d-%H%M%S}-{stem}"


def create_run_dir(archive_dir: str, quiz_filename: str, now: Optional[datetime] = None) -> str:
    """Create a new run folder (a "-2", "-3" suffix when one was already started this second)."""
    os.makedirs(archive_dir, exist_ok=True)
    base = run_folder_name(quiz_filename, now or datetime.now())
    name, counter = base, 2
    while os.path.exists(os.path.join(archive_dir, name)):
        name = f"{base}-{counter}"
        counter += 1
    path = os.path.join(archive_dir, name)
    os.makedirs(path)
    return path


def write_summary(run_dir: str, summary: Dict[str, Any]):
    """Write summary.json (through a temp file, so a reader never sees half of it)."""
    path = os.path.join(run_dir, SUMMARY_FILE)
    temp_path = path + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_path, path)


def read_summary(run_dir: str) -> Dict[str, Any]:
    try:
        with open(os.path.join(run_dir, SUMMARY_FILE), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


# Order of the files of a run in the admin app: the results (users.csv) first, the log last
FILE_ORDER = (USERS_CSV, ANSWERS_CSV, ANSWERS_WITH_USERS_CSV)


def _file_sort_key(name: str):
    if name in FILE_ORDER:
        return (0, FILE_ORDER.index(name), name)
    return (2 if name == LOG_FILE else 1, 0, name)


def run_files(run_dir: str) -> List[Dict[str, Any]]:
    """Files of a run (summary.json is internal): answers, users, other files, the log last."""
    files = []
    for name in sorted(os.listdir(run_dir), key=_file_sort_key):
        path = os.path.join(run_dir, name)
        if name == SUMMARY_FILE or not os.path.isfile(path) or not is_valid_file_name(name):
            continue
        files.append({"name": name, "size": os.path.getsize(path)})
    return files


_NUMBER_PATTERN = re.compile(r"^-?(0|[1-9]\d{0,14})(\.\d+)?$")
_XML_INVALID = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _column_name(index: int) -> str:
    """0 -> "A", 25 -> "Z", 26 -> "AA"."""
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def _xml_text(value: str) -> str:
    value = _XML_INVALID.sub("", value)
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# Cell styles of the workbook (indexes into cellXfs in styles.xml); every cell has thin borders
STYLE_HEADER, STYLE_CENTER, STYLE_LEFT = 1, 2, 3


def rows_to_xlsx(rows: List[List[str]], left_columns: Iterable[int] = ()) -> bytes:
    """A one-sheet Excel workbook: numbers as numbers, everything else as text, a bold centered header row,
    borders around every cell; cells are centered except in ``left_columns`` (names, registration fields,
    question and answer texts)."""
    left = set(left_columns)
    width = max((len(row) for row in rows), default=0)
    widths: Dict[int, int] = {}
    sheet_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = []
        # Every column gets a cell, so the borders form a full grid
        for column in range(width):
            value = (row[column] if column < len(row) else "") or ""
            longest = max((len(line) for line in value.split("\n")), default=0)
            widths[column] = max(widths.get(column, 0), longest)
            ref = f"{_column_name(column)}{row_number}"
            if row_number == 1:
                style = STYLE_HEADER
            else:
                style = STYLE_LEFT if column in left else STYLE_CENTER
            if row_number > 1 and _NUMBER_PATTERN.match(value):
                cells.append(f'<c r="{ref}" s="{style}"><v>{value}</v></c>')
            elif value:
                cells.append(
                    f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{_xml_text(value)}</t></is></c>'
                )
            else:
                cells.append(f'<c r="{ref}" s="{style}"/>')
        sheet_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    cols = "".join(
        f'<col min="{c + 1}" max="{c + 1}" width="{min(60, max(8, w + 2))}" customWidth="1"/>' for c, w in sorted(widths.items())
    )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        # No frozen header: Excel draws the freeze line across the whole window, past the table
        + (f"<cols>{cols}</cols>" if cols else "")
        + f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        ),
        "xl/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
            '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>'
            '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>'
            "</borders>"
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            # 1: header, centered
            '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">'
            '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            # 2: centered
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">'
            '<alignment horizontal="center" vertical="center"/></xf>'
            # 3: left
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">'
            '<alignment horizontal="left" vertical="center"/></xf>'
            "</cellXfs>"
            "</styleSheet>"
        ),
        "xl/worksheets/sheet1.xml": sheet,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as workbook:
        for name, content in parts.items():
            workbook.writestr(name, content)
    return buffer.getvalue()


def csv_to_xlsx(path: str, left_headers: Iterable[str] = ()) -> bytes:
    """Excel version of a CSV file; columns whose header is in ``left_headers`` stay left-aligned."""
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    names = set(left_headers)
    left = [index for index, header in enumerate(rows[0] if rows else []) if header in names]
    return rows_to_xlsx(rows, left)


def list_runs(archive_dir: str) -> List[Dict[str, Any]]:
    """All runs, newest first: folder name, its summary and files."""
    if not os.path.isdir(archive_dir):
        return []
    runs = []
    for name in os.listdir(archive_dir):
        run_dir = os.path.join(archive_dir, name)
        if not is_valid_run_name(name) or not os.path.isdir(run_dir):
            continue
        runs.append({"name": name, **read_summary(run_dir), "files": run_files(run_dir)})
    runs.sort(key=lambda run: run["name"], reverse=True)
    return runs


def zip_run(run_dir: str) -> bytes:
    """The run folder as a zip with fixed timestamps, so the same files always give the same bytes
    (the receiver of a transfer compares checksums)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(os.listdir(run_dir)):
            path = os.path.join(run_dir, name)
            if not os.path.isfile(path) or not is_valid_file_name(name) or name.endswith(".tmp"):
                continue
            info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as f:
                archive.writestr(info, f.read())
    return buffer.getvalue()


def unzip_run(data: bytes, target_dir: str):
    """Unpack a run zip into a new folder; only plain file names are accepted."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if not all(is_valid_file_name(name) for name in names):
            raise ValueError("Unexpected file name in the archive")
        os.makedirs(target_dir)
        for name in names:
            with open(os.path.join(target_dir, name), "wb") as f:
                f.write(archive.read(name))


class RunLogHandler(logging.Handler):
    """Writes the log into the current run folder.

    Records logged before the first run (server startup) are kept in memory and
    written to the first run's log, so its log starts with the startup information.
    """

    def __init__(self, buffer_size: int = 5000):
        super().__init__()
        self.setFormatter(logging.Formatter(LOG_FORMAT))
        self._file: Optional[logging.FileHandler] = None
        self._pending: deque = deque(maxlen=buffer_size)

    @property
    def path(self) -> Optional[str]:
        return self._file.baseFilename if self._file else None

    def set_file(self, path: str):
        """Continue the log in another file (the old one is closed)."""
        new_file = logging.FileHandler(path, encoding="utf-8")
        new_file.setFormatter(self.formatter)
        self.acquire()
        try:
            old_file, self._file = self._file, new_file
            while self._pending:
                new_file.emit(self._pending.popleft())
        finally:
            self.release()
        if old_file:
            old_file.close()

    def emit(self, record: logging.LogRecord):
        if self._file:
            self._file.emit(record)
        else:
            self._pending.append(record)

    def close(self):
        if self._file:
            self._file.close()
        super().close()


# One handler for the whole process: the server switches it to each new run folder
run_log_handler = RunLogHandler()

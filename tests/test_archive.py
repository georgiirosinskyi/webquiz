"""Quiz run archive: one folder per run with its CSV files, log and summary.json.

Unit tests for webquiz/archive.py and API tests for the Archive section
(GET /api/admin/archive, GET /api/admin/archive/{run}/{file}) and the quiz file download.
"""

import json
import logging
import os
import time
from datetime import datetime

import pytest
import requests

from conftest import custom_webquiz_server, get_admin_session, get_page_data, latest_run_dir
from webquiz import archive

QUIZ = {
    "title": "Archive Quiz",
    "questions": [
        {"question": "Q1", "options": ["A", "B"], "correct_answer": 0},
        {"question": "Q2", "options": ["A", "B"], "correct_answer": 1},
    ],
}


# ----- archive.py -----


def test_run_folder_name():
    now = datetime(2026, 10, 15, 14, 30, 5)
    assert archive.run_folder_name("grade5/math.yaml", now) == "2026-10-15-143005-grade5_math"
    assert archive.run_folder_name("тест.yml", now) == "2026-10-15-143005-тест"
    assert archive.is_valid_run_name("2026-10-15-143005-grade5_math")
    assert not archive.is_valid_run_name("../2026-10-15-143005-x")
    assert not archive.is_valid_run_name("notes")


def test_create_run_dir_adds_suffix_in_the_same_second(tmp_path):
    now = datetime(2026, 10, 15, 14, 30, 5)
    first = archive.create_run_dir(str(tmp_path), "quiz.yaml", now)
    second = archive.create_run_dir(str(tmp_path), "quiz.yaml", now)
    assert os.path.basename(first) == "2026-10-15-143005-quiz"
    assert os.path.basename(second) == "2026-10-15-143005-quiz-2"


def test_list_runs_newest_first_with_summary_and_files(tmp_path):
    old = archive.create_run_dir(str(tmp_path), "a.yaml", datetime(2026, 1, 1, 9, 0, 0))
    new = archive.create_run_dir(str(tmp_path), "b.yaml", datetime(2026, 2, 1, 9, 0, 0))
    archive.write_summary(new, {"users": 3})
    with open(os.path.join(new, "users.csv"), "w") as f:
        f.write("x")
    os.makedirs(tmp_path / "not-a-run")

    runs = archive.list_runs(str(tmp_path))
    assert [run["name"] for run in runs] == [os.path.basename(new), os.path.basename(old)]
    assert runs[0]["users"] == 3
    assert runs[0]["files"] == [{"name": "users.csv", "size": 1}]  # summary.json is internal


def test_zip_run_is_stable_and_unzips(tmp_path):
    run = archive.create_run_dir(str(tmp_path / "a"), "q.yaml")
    with open(os.path.join(run, "users.csv"), "w") as f:
        f.write("№,ПІБ\n")
    data = archive.zip_run(run)
    time.sleep(1.1)
    os.utime(os.path.join(run, "users.csv"))
    assert archive.zip_run(run) == data  # same files -> same bytes, so checksums match

    target = str(tmp_path / "copy")
    archive.unzip_run(data, target)
    with open(os.path.join(target, "users.csv"), encoding="utf-8") as f:
        assert f.read() == "№,ПІБ\n"


def test_unzip_run_rejects_paths(tmp_path):
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("../evil.txt", "x")
    with pytest.raises(ValueError):
        archive.unzip_run(buffer.getvalue(), str(tmp_path / "run"))
    assert not os.path.exists(tmp_path / "evil.txt")


def test_run_log_handler_keeps_startup_lines_for_the_first_run(tmp_path):
    handler = archive.RunLogHandler()
    log = logging.getLogger("test_run_log_handler")
    log.propagate = False
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        log.info("before any run")
        handler.set_file(str(tmp_path / "first.log"))
        log.info("in the first run")
        handler.set_file(str(tmp_path / "second.log"))
        log.info("in the second run")
    finally:
        log.removeHandler(handler)
        handler.close()
    first = (tmp_path / "first.log").read_text(encoding="utf-8")
    second = (tmp_path / "second.log").read_text(encoding="utf-8")
    assert "before any run" in first and "in the first run" in first
    assert "in the second run" in second and "first run" not in second


# ----- server -----


def _answer(port, user_id, question_id, answer):
    requests.post(
        f"http://localhost:{port}/api/submit-answer",
        json={"user_id": user_id, "question_id": question_id, "selected_answer": answer},
    )


def test_run_folder_has_csv_log_and_summary(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna"}).json()["user_id"]
        _answer(port, user_id, 1, 0)
        _answer(port, user_id, 2, 0)
        time.sleep(6)  # periodic flush

        run = latest_run_dir(port)
        assert os.path.basename(run).endswith("-quiz")
        assert {"answers.csv", "users.csv", "server.log", "summary.json"} <= set(os.listdir(run))
        with open(os.path.join(run, "server.log"), encoding="utf-8") as f:
            log = f.read()
        assert "WebQuiz Server Starting" in log  # startup lines go to the first run
        with open(os.path.join(run, "summary.json"), encoding="utf-8") as f:
            summary = json.load(f)
        assert summary["quiz"] == "quiz.yaml"
        assert summary["title"] == "Archive Quiz"
        assert summary["total_questions"] == 2
        assert summary["users"] == 1
        assert summary["correct_percent"] == 50


def test_switch_starts_a_new_run_and_saves_the_old_one(temp_dir):
    quizzes = {"default.yaml": QUIZ, "other.yaml": QUIZ}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna"}).json()["user_id"]
        _answer(port, user_id, 1, 0)
        first = latest_run_dir(port)

        # Switch right away: the answer is still in memory and must reach the old run's CSV
        result = requests.post(
            f"http://localhost:{port}/api/admin/switch-quiz",
            cookies=get_admin_session(port),
            json={"quiz_filename": "other.yaml"},
        ).json()
        second = latest_run_dir(port)
        assert second != first
        assert result["run"] == os.path.basename(second)
        assert os.path.basename(second).endswith("-other")
        with open(os.path.join(first, "answers.csv"), encoding="utf-8") as f:
            assert "Anna" in f.read()
        with open(os.path.join(first, "summary.json"), encoding="utf-8") as f:
            assert json.load(f)["users"] == 1


def test_archive_api_lists_runs_with_live_numbers(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        cookies = get_admin_session(port)
        user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna"}).json()["user_id"]
        _answer(port, user_id, 1, 0)

        data = requests.get(f"http://localhost:{port}/api/admin/archive", cookies=cookies).json()
        run = data["runs"][0]
        assert run["current"] is True
        assert data["current"] == run["name"]
        assert run["users"] == 1
        assert run["answers"] == 1
        assert run["correct_percent"] == 100
        assert run["title"] == "Archive Quiz"
        assert "server.log" in [f["name"] for f in run["files"]]


def test_archive_file_view_and_download(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        cookies = get_admin_session(port)
        requests.post(f"http://localhost:{port}/api/register", json={"username": "Олена"})
        run = os.path.basename(latest_run_dir(port))

        # Viewing the current run flushes what is still in memory
        view = requests.get(f"http://localhost:{port}/api/admin/archive/{run}/users.csv", cookies=cookies)
        assert view.status_code == 200
        assert "Олена" in view.text

        download = requests.get(f"http://localhost:{port}/api/admin/archive/{run}/users.csv?download=1", cookies=cookies)
        assert download.status_code == 200
        assert "attachment" in download.headers["Content-Disposition"]
        assert "Олена" in download.content.decode("utf-8")

        missing = requests.get(f"http://localhost:{port}/api/admin/archive/{run}/nothing.csv", cookies=cookies)
        assert missing.status_code == 404
        bad = requests.get(f"http://localhost:{port}/api/admin/archive/notarun/users.csv", cookies=cookies)
        assert bad.status_code == 400


def test_archive_api_requires_admin(temp_dir):
    with custom_webquiz_server() as (proc, port):
        assert requests.get(f"http://localhost:{port}/api/admin/archive").status_code == 401
        run = os.path.basename(latest_run_dir(port))
        assert requests.get(f"http://localhost:{port}/api/admin/archive/{run}/server.log").status_code == 401


def test_download_quiz_file(temp_dir):
    with custom_webquiz_server(quizzes={"grade5/math.yaml": QUIZ}) as (proc, port):
        cookies = get_admin_session(port)
        response = requests.get(f"http://localhost:{port}/api/admin/quiz-file/grade5%2Fmath.yaml", cookies=cookies)
        assert response.status_code == 200
        assert "attachment" in response.headers["Content-Disposition"]
        assert "Archive Quiz" in response.content.decode("utf-8")

        traversal = requests.get(f"http://localhost:{port}/api/admin/quiz-file/..%2Fcustom_config_{port}.yaml", cookies=cookies)
        assert traversal.status_code == 404
        assert requests.get(f"http://localhost:{port}/api/admin/quiz-file/grade5%2Fmath.yaml").status_code == 401


def test_old_files_url_opens_the_admin_app(temp_dir):
    with custom_webquiz_server() as (proc, port):
        response = requests.get(f"http://localhost:{port}/files/")
        assert response.status_code == 200
        assert {"isTrustedIp", "configPath", "networkUrls"} <= set(get_page_data(response.text)["page"])


def test_old_path_keys_in_config_are_ignored(temp_dir):
    config = {"paths": {"logs_dir": "old_logs", "csv_dir": "old_data"}}
    with custom_webquiz_server(config=config) as (proc, port):
        assert requests.get(f"http://localhost:{port}/api/quiz-version").status_code == 200
        assert not os.path.exists("old_logs") and not os.path.exists("old_data")
        assert latest_run_dir(port)


def test_run_files_put_results_first_and_the_log_last(tmp_path):
    run = archive.create_run_dir(str(tmp_path), "q.yaml")
    for name in ("server.log", "users.csv", "answers.csv", "notes.txt", "answers_with_users.csv"):
        with open(os.path.join(run, name), "w") as f:
            f.write("x")
    names = [f["name"] for f in archive.run_files(run)]
    assert names == ["users.csv", "answers.csv", "answers_with_users.csv", "notes.txt", "server.log"]


def test_rows_to_xlsx_is_a_workbook_with_numbers_and_text():
    import io
    import zipfile

    rows = [["№", "ПІБ", "Час"], ["1", "Олена <&>", "00:01:05"], ["2", "Петро", "007"], ["3"]]
    data = archive.rows_to_xlsx(rows, left_columns=[1])
    with zipfile.ZipFile(io.BytesIO(data)) as workbook:
        assert "[Content_Types].xml" in workbook.namelist()
        sheet = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
        styles = workbook.read("xl/styles.xml").decode("utf-8")
    center, left = archive.STYLE_CENTER, archive.STYLE_LEFT
    assert f'<c r="A2" s="{center}"><v>1</v></c>' in sheet  # a number stays a number, centered
    assert f'<c r="B2" s="{left}" t="inlineStr">' in sheet  # the name stays left-aligned
    assert "Олена &lt;&amp;&gt;" in sheet  # text is escaped
    assert "<v>007</v>" not in sheet  # a leading zero keeps the value as text
    assert f'<c r="A1" s="{archive.STYLE_HEADER}" t="inlineStr">' in sheet  # bold centered header
    assert f'<c r="B1" s="{archive.STYLE_HEADER}" t="inlineStr">' in sheet  # also above a left-aligned column
    assert "frozen" not in sheet
    assert f'<c r="C4" s="{center}"/>' in sheet  # short rows still get bordered cells
    assert 'style="thin"' in styles


def test_archive_csv_downloads_as_xlsx(temp_dir):
    import io
    import zipfile

    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        cookies = get_admin_session(port)
        requests.post(f"http://localhost:{port}/api/register", json={"username": "Олена"})
        run = os.path.basename(latest_run_dir(port))
        response = requests.get(
            f"http://localhost:{port}/api/admin/archive/{run}/users.csv?download=1&format=xlsx", cookies=cookies
        )
        assert response.status_code == 200
        assert "spreadsheetml" in response.headers["Content-Type"]
        assert ".xlsx" in response.headers["Content-Disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as workbook:
            assert "Олена" in workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")

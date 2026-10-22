"""Tests for the features added in this fork.

Covers question navigation (answering in any order), skipping questions, the time limit
with /api/finish-test, grades (marks), the localized CSV output, recursive quiz discovery
and the quiz page elements (timer, navigation, skip button), light theme only.
"""

import csv
import glob
import os
import re
import time

import requests

from conftest import custom_webquiz_server, get_admin_session, get_page_data


FOUR_QUESTIONS = {
    "title": "Fork Quiz",
    "questions": [
        {"question": "Q1", "options": ["A", "B"], "correct_answer": 0},
        {"question": "Q2", "options": ["C", "D"], "correct_answer": 1},
        {"question": "Q3", "options": ["E", "F"], "correct_answer": 0},
        {"question": "Q4", "options": ["G", "H"], "correct_answer": 1},
    ],
}


def quiz(**settings):
    return {**FOUR_QUESTIONS, **settings}


def register(port, username="student", **extra):
    response = requests.post(f"http://localhost:{port}/api/register", json={"username": username, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def submit(port, user_id, question_id, answer):
    return requests.post(
        f"http://localhost:{port}/api/submit-answer",
        json={"user_id": user_id, "question_id": question_id, "selected_answer": answer},
    )


def skip(port, user_id, question_id):
    return requests.post(
        f"http://localhost:{port}/api/skip-question",
        json={"user_id": user_id, "question_id": question_id},
    )


def finish(port, user_id, reason="timeout"):
    return requests.post(f"http://localhost:{port}/api/finish-test", json={"user_id": user_id, "reason": reason})


def verify(port, user_id):
    response = requests.get(f"http://localhost:{port}/api/verify-user/{user_id}")
    assert response.status_code == 200
    return response.json()


def test_register_returns_time_limit_and_skip_settings(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(time_limit=120, allow_skip_questions=True)}) as (proc, port):
        data = register(port)
        assert data["time_limit"] == 120
        assert data["allow_skip_questions"] is True
        assert "quiz_start_time" in data


def test_questions_can_be_answered_in_any_order(temp_dir):
    """Navigation lets a student answer questions out of order, also with randomization."""
    for settings in ({}, {"randomize_questions": True}):
        with custom_webquiz_server(quizzes={"quiz.yaml": quiz(**settings)}) as (proc, port):
            user_id = register(port)["user_id"]
            for question_id in (3, 1, 4, 2):
                response = submit(port, user_id, question_id, 0)
                assert response.status_code == 200, response.text

            data = verify(port, user_id)
            assert data["test_completed"] is True
            results = data["final_results"]
            assert results["total_count"] == 4
            # Results are listed in the student's question order, not in answering order
            expected_order = data.get("question_order", [1, 2, 3, 4])
            assert [r["question_id"] for r in results["test_results"]] == expected_order


def test_answered_question_cannot_be_answered_again(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        user_id = register(port)["user_id"]
        assert submit(port, user_id, 2, 1).status_code == 200
        assert submit(port, user_id, 2, 0).status_code == 409
        assert verify(port, user_id)["test_completed"] is False


def test_skip_forbidden_by_default(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        user_id = register(port)["user_id"]
        response = skip(port, user_id, 1)
        assert response.status_code == 403
        assert response.json()["error"] == "Пропуск питань заборонено"


def test_skip_message_translated_to_english(temp_dir):
    with custom_webquiz_server(config={"language": "en"}, quizzes={"quiz.yaml": quiz()}) as (proc, port):
        user_id = register(port)["user_id"]
        assert skip(port, user_id, 1).json()["error"] == "Skipping questions is not allowed"


def test_skipped_question_can_be_answered_later(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(allow_skip_questions=True)}) as (proc, port):
        user_id = register(port)["user_id"]

        assert skip(port, user_id, 1).status_code == 200
        # A retried skip is harmless
        assert skip(port, user_id, 1).status_code == 200
        for question_id in (2, 3, 4):
            assert submit(port, user_id, question_id, 0).status_code == 200
        assert verify(port, user_id)["test_completed"] is False, "Skipped question is still unanswered"

        assert submit(port, user_id, 1, 0).status_code == 200
        data = verify(port, user_id)
        assert data["test_completed"] is True
        assert data["final_results"]["total_count"] == 4


def test_finish_by_timeout_fills_unanswered_questions(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(time_limit=60)}) as (proc, port):
        user_id = register(port)["user_id"]
        assert submit(port, user_id, 1, 0).status_code == 200  # correct
        assert submit(port, user_id, 3, 1).status_code == 200  # wrong

        response = finish(port, user_id)
        assert response.status_code == 200
        # A retried finish request must not add placeholders twice
        assert finish(port, user_id).status_code == 200

        data = verify(port, user_id)
        assert data["test_completed"] is True
        results = data["final_results"]
        assert len(results["test_results"]) == 4
        assert results["total_count"] == 2, "total_count counts only the answers actually given"
        assert results["correct_count"] == 1
        assert results["percentage"] == 25
        assert results["mark"] == 2
        unanswered = [r for r in results["test_results"] if r["question_id"] in (2, 4)]
        assert all(r["selected_answer"] == "" and r["is_correct"] is False for r in unanswered)

        # An answer that arrives after the time is up is not accepted
        assert submit(port, user_id, 2, 1).status_code == 409


def test_default_marks(temp_dir):
    cases = [((0, 1, 0, 1), 5), ((0, 1, 0, 0), 3), ((1, 0, 1, 0), 2)]
    for answers, expected_mark in cases:
        with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
            user_id = register(port)["user_id"]
            for question_id, answer in enumerate(answers, start=1):
                assert submit(port, user_id, question_id, answer).status_code == 200
            assert verify(port, user_id)["final_results"]["mark"] == expected_mark


def test_custom_marks(temp_dir):
    marks = [{"grade": 12, "min_score": 75}, {"grade": 6, "min_score": 50}]
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(marks=marks)}) as (proc, port):
        user_id = register(port)["user_id"]
        for question_id, answer in enumerate((0, 1, 0, 0), start=1):  # 3 of 4 correct = 75%
            assert submit(port, user_id, question_id, answer).status_code == 200
        assert verify(port, user_id)["final_results"]["mark"] == 12


def test_csv_files_use_localized_format(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        user_id = register(port, username="Іваненко")["user_id"]
        for question_id, answer in enumerate((0, 1, 0, 0), start=1):
            assert submit(port, user_id, question_id, answer).status_code == 200

        time.sleep(6)  # periodic flush runs every 5 seconds
        data_dir = f"data_{port}"
        users_csv = glob.glob(os.path.join(data_dir, "*.users.csv"))
        answers_csv = [p for p in glob.glob(os.path.join(data_dir, "*.csv")) if p not in users_csv]
        assert len(users_csv) == 1 and len(answers_csv) == 1

        with open(users_csv[0], encoding="utf-8", newline="") as f:
            rows = list(csv.reader(f))
        assert rows[0] == [
            "№", "ПІБ", "Оцінка", "Витрачено часу", "Дано відповідей",
            "Правильні відповіді", "Всього питань", "Старт тесту", "Завершення тесту",
        ]
        assert rows[1][:3] == ["1", "Іваненко", "3"]
        assert rows[1][4:7] == ["4", "3", "4"]

        with open(answers_csv[0], encoding="utf-8", newline="") as f:
            content = f.read()
        assert "\r\n" not in content, "CSV lines end with \\n"
        rows = list(csv.reader(content.splitlines()))
        assert rows[0] == ["ПІБ", "Питання", "Відповідь", "Правильна відповідь", "Результат", "Витрачено часу"]
        assert [row[4] for row in rows[1:]] == ["Вірно", "Вірно", "Вірно", "Помилка"]
        assert all(row[0] == "Іваненко" for row in rows[1:])


def test_quizzes_found_in_subfolders(temp_dir):
    quizzes = {"main.yaml": quiz(title="Main")}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        sub_dir = os.path.join(f"quizzes_{port}", "grade5")
        os.makedirs(sub_dir)
        with open(os.path.join(sub_dir, "math.yaml"), "w", encoding="utf-8") as f:
            f.write("title: Sub Quiz\nquestions:\n  - question: S1\n    options: [a, b]\n    correct_answer: 0\n")

        cookies = get_admin_session(port)
        base = f"http://localhost:{port}"
        listing = requests.get(f"{base}/api/admin/list-quizzes", cookies=cookies).json()
        # Forward slashes on every OS, so the name matches current_quiz
        assert [q["filename"] for q in listing["quizzes"]] == ["grade5/math.yaml", "main.yaml"]

        response = requests.post(
            f"{base}/api/admin/switch-quiz", json={"quiz_filename": "grade5/math.yaml"}, cookies=cookies
        )
        assert response.status_code == 200, response.text
        assert response.json()["current_quiz"] == "grade5/math.yaml"
        listing = requests.get(f"{base}/api/admin/list-quizzes", cookies=cookies).json()
        assert listing["current_quiz"] == "grade5/math.yaml"

        # The admin page sends the name URL-encoded
        response = requests.get(f"{base}/api/admin/quiz/grade5%2Fmath.yaml", cookies=cookies)
        assert response.status_code == 200, response.text
        assert response.json()["parsed"]["title"] == "Sub Quiz"

        # The active quiz is recognized by its relative name and cannot be deleted
        response = requests.delete(f"{base}/api/admin/quiz/grade5%2Fmath.yaml", cookies=cookies)
        assert response.status_code == 400

        # Saving the config restarts the active quiz; a subfolder quiz must stay active
        with open(f"custom_config_{port}.yaml", encoding="utf-8") as f:
            config_content = f.read()
        response = requests.put(f"{base}/api/admin/config", json={"content": config_content}, cookies=cookies)
        assert response.status_code == 200, response.text
        listing = requests.get(f"{base}/api/admin/list-quizzes", cookies=cookies).json()
        assert listing["current_quiz"] == "grade5/math.yaml"

        # An inactive subfolder quiz can be deleted
        requests.post(f"{base}/api/admin/switch-quiz", json={"quiz_filename": "main.yaml"}, cookies=cookies)
        response = requests.delete(f"{base}/api/admin/quiz/grade5%2Fmath.yaml", cookies=cookies)
        assert response.status_code == 200, response.text
        assert not os.path.exists(os.path.join(sub_dir, "math.yaml"))


def test_quiz_paths_outside_quizzes_dir_rejected(temp_dir):
    with custom_webquiz_server(quizzes={"main.yaml": quiz()}) as (proc, port):
        cookies = get_admin_session(port)
        base = f"http://localhost:{port}"
        with open("outside.yaml", "w", encoding="utf-8") as f:
            f.write("title: Outside\nquestions: []\n")
        for name in ("..%2Foutside.yaml", "..%2F..%2Foutside.yaml", "%2Fetc%2Fpasswd.yaml", "main.txt"):
            response = requests.get(f"{base}/api/admin/quiz/{name}", cookies=cookies)
            assert response.status_code in (400, 404), name
            assert "Outside" not in response.text
        response = requests.post(
            f"{base}/api/admin/switch-quiz", json={"quiz_filename": "../outside.yaml"}, cookies=cookies
        )
        assert response.status_code != 200


def test_quiz_page_has_fork_elements(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        # The elements are rendered by the page script (frontend/src/quiz/QuizApp.tsx)
        html = requests.get(f"http://localhost:{port}/").text
        script = re.search(r'src="(ui/assets/quiz-[^"]+\.js)"', html).group(1)
        js = requests.get(f"http://localhost:{port}/{script}").text
        for element_id in ["timer", "nav", "skip-question-btn"]:
            assert f'id:"{element_id}"' in js, element_id
        assert "progress-bar" not in js, "The progress bar was removed in this fork"
        assert get_page_data(html)["page"]["translations"]["skip_question"] == "Пропустити питання"
        assert "img/background.png" in js

    with custom_webquiz_server(config={"language": "en"}, quizzes={"quiz.yaml": quiz()}) as (proc, port):
        html = requests.get(f"http://localhost:{port}/").text
        assert get_page_data(html)["page"]["translations"]["skip_question"] == "Skip question"


def test_pages_have_only_light_theme(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        cookies = get_admin_session(port)
        for path in ["/", "/admin/", "/live-stats/", "/files/"]:
            response = requests.get(f"http://localhost:{port}{path}", cookies=cookies)
            assert response.status_code == 200, path
            html = response.text
            assert "theme-toggle" not in html, path
            assert "toggleTheme" not in html, path
            assert "data-theme" not in html, path


def test_background_images_served(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        for name in ("background.png", "top-left.png", "top-right.png"):
            response = requests.get(f"http://localhost:{port}/img/{name}")
            assert response.status_code == 200, name
            assert response.content[:4] == b"\x89PNG"


def question_start(port, user_id, question_id):
    return requests.post(
        f"http://localhost:{port}/api/question-start", json={"user_id": user_id, "question_id": question_id}
    )


def users_csv_rows(port):
    time.sleep(6)  # periodic flush runs every 5 seconds
    users_csv = glob.glob(os.path.join(f"data_{port}", "*.users.csv"))
    assert len(users_csv) == 1
    with open(users_csv[0], encoding="utf-8", newline="") as f:
        return list(csv.reader(f))


MIXED_QUESTIONS = {
    "title": "Mixed",
    "allow_skip_questions": True,
    "time_limit": 600,
    "questions": [
        {"question": "Single", "options": ["A", "B"], "correct_answer": 0},
        {"question": "Multi", "options": ["A", "B", "C"], "correct_answer": [0, 2]},
        {"question": "Text", "checker": "", "correct_value": "42"},
        {"question": "Last", "options": ["A", "B"], "correct_answer": 1},
    ],
}


def test_verify_returns_state_for_page_reload(temp_dir):
    """After a reload the page needs the timer, skip permission and answered/skipped questions."""
    with custom_webquiz_server(quizzes={"quiz.yaml": MIXED_QUESTIONS}) as (proc, port):
        user_id = register(port)["user_id"]
        assert submit(port, user_id, 1, 1).status_code == 200
        assert skip(port, user_id, 2).status_code == 200
        assert submit(port, user_id, 3, "42").status_code == 200

        data = verify(port, user_id)
        assert data["test_completed"] is False
        assert data["time_limit"] == 600
        assert 590 <= data["remaining_seconds"] <= 600
        assert data["allow_skip_questions"] is True
        assert data["answered_questions"] == {"1": 1, "3": "42"}
        assert data["skipped_questions"] == [2]

        assert submit(port, user_id, 2, [0, 2]).status_code == 200
        assert verify(port, user_id)["answered_questions"]["2"] == [0, 2]


def test_verify_without_time_limit(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        data = verify(port, register(port)["user_id"])
        assert data["remaining_seconds"] is None
        assert not data["time_limit"]
        assert data["allow_skip_questions"] is False


def test_answered_question_cannot_be_skipped(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(allow_skip_questions=True)}) as (proc, port):
        user_id = register(port)["user_id"]
        assert submit(port, user_id, 1, 0).status_code == 200
        assert skip(port, user_id, 1).status_code == 409


def test_time_limit_enforced_by_server(temp_dir):
    """Answers after the limit (plus a grace period) are rejected and the test is finished.

    The page may be closed or its timer delayed, so the server has to enforce the limit.
    """
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(time_limit=1, allow_skip_questions=True)}) as (proc, port):
        late_user = register(port, username="late")["user_id"]
        away_user = register(port, username="away")["user_id"]
        assert submit(port, late_user, 1, 0).status_code == 200

        time.sleep(12)  # 1 s limit + 10 s grace for slow requests

        response = submit(port, late_user, 2, 1)
        assert response.status_code == 409
        assert response.json()["time_is_up"] is True
        assert skip(port, late_user, 3).status_code == 409

        data = verify(port, late_user)
        assert data["test_completed"] is True
        assert data["remaining_seconds"] == 0
        assert data["final_results"]["total_count"] == 1
        assert data["final_results"]["correct_count"] == 1

        # A student who closed the page gets the test finished on the next visit
        data = verify(port, away_user)
        assert data["test_completed"] is True
        assert data["final_results"]["total_count"] == 0


def test_finish_after_completion_keeps_results(temp_dir):
    """A late timeout request must not move the finish time of a completed test."""
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(time_limit=600)}) as (proc, port):
        user_id = register(port)["user_id"]
        for question_id in (1, 2, 3, 4):
            assert submit(port, user_id, question_id, 0).status_code == 200
        before = verify(port, user_id)["final_results"]

        assert finish(port, user_id, "timeout").status_code == 200
        assert verify(port, user_id)["final_results"] == before

        row = users_csv_rows(port)[1]
        assert row[3] == "00:00:00", "Finish time must stay when the test was completed, not start + time limit"


def test_finish_test_validation(temp_dir):
    with custom_webquiz_server(
        config={"registration": {"approve": True}}, quizzes={"quiz.yaml": quiz(time_limit=60)}
    ) as (proc, port):
        user_id = register(port)["user_id"]
        # Not approved yet: the test has not started
        assert finish(port, user_id).status_code == 400
        response = requests.post(f"http://localhost:{port}/api/finish-test", json={"user_id": "000000"})
        assert response.status_code == 404

    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        user_id = register(port)["user_id"]
        # The reason is optional
        response = requests.post(f"http://localhost:{port}/api/finish-test", json={"user_id": user_id})
        assert response.status_code == 200
        assert verify(port, user_id)["test_completed"] is True


def test_total_time_ignores_unanswered_placeholders(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(time_limit=600)}) as (proc, port):
        user_id = register(port)["user_id"]
        assert submit(port, user_id, 1, 0).status_code == 200
        assert finish(port, user_id).status_code == 200
        assert verify(port, user_id)["final_results"]["total_time"] >= 0


def test_mark_uses_points(temp_dir):
    """With question points the grade follows the points percentage."""
    weighted = {
        "title": "Weighted",
        "questions": [
            {"question": "Big", "options": ["A", "B"], "correct_answer": 0, "points": 7},
            {"question": "Q2", "options": ["A", "B"], "correct_answer": 0},
            {"question": "Q3", "options": ["A", "B"], "correct_answer": 0},
            {"question": "Q4", "options": ["A", "B"], "correct_answer": 0},
        ],
    }
    with custom_webquiz_server(quizzes={"quiz.yaml": weighted}) as (proc, port):
        user_id = register(port)["user_id"]
        for question_id, answer in ((1, 0), (2, 1), (3, 1), (4, 1)):
            assert submit(port, user_id, question_id, answer).status_code == 200
        results = verify(port, user_id)["final_results"]
        assert results["percentage"] == 25
        assert results["points_percentage"] == 70
        assert results["mark"] == 3
        assert users_csv_rows(port)[1][2] == "3"


def test_default_mark_and_invalid_rules(temp_dir):
    marks = [{"grade": 12, "min_score": 90}, {"grade": "bad", "min_score": "x"}, {"grade": 6}]
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(marks=marks, default_mark=1)}) as (proc, port):
        user_id = register(port)["user_id"]
        for question_id in (1, 2, 3, 4):
            assert submit(port, user_id, question_id, 0).status_code == 200  # 2 of 4 correct
        assert verify(port, user_id)["final_results"]["mark"] == 1


def test_question_time_follows_shown_question(temp_dir):
    """Time spent on another question before navigating away is not counted for the answered one."""
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz(allow_skip_questions=True)}) as (proc, port):
        user_id = register(port)["user_id"]
        assert question_start(port, user_id, 1).status_code == 200
        time.sleep(1.5)  # on question 1
        assert question_start(port, user_id, 3).status_code == 200
        time.sleep(0.2)
        response = submit(port, user_id, 3, 0)
        assert response.status_code == 200
        assert response.json()["time_taken"] < 1.0

        # A repeated notice for the same question keeps the original start
        assert question_start(port, user_id, 2).status_code == 200
        time.sleep(0.6)
        assert question_start(port, user_id, 2).status_code == 200
        assert submit(port, user_id, 2, 1).json()["time_taken"] >= 0.5

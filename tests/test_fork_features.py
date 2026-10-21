"""Tests for the features added in this fork.

Covers question navigation (answering in any order), skipping questions, the time limit
with /api/finish-test, grades (marks), the localized CSV output, recursive quiz discovery
and the quiz page elements (timer, navigation, skip button).
"""

import csv
import glob
import os
import time

import requests

from conftest import custom_webquiz_server, get_admin_session


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
        listing = requests.get(f"http://localhost:{port}/api/admin/list-quizzes", cookies=cookies).json()
        filenames = [q["filename"].replace("\\", "/") for q in listing["quizzes"]]
        assert "grade5/math.yaml" in filenames

        sub_filename = next(q["filename"] for q in listing["quizzes"] if q["filename"].endswith("math.yaml"))
        response = requests.post(
            f"http://localhost:{port}/api/admin/switch-quiz", json={"quiz_filename": sub_filename}, cookies=cookies
        )
        assert response.status_code == 200, response.text
        listing = requests.get(f"http://localhost:{port}/api/admin/list-quizzes", cookies=cookies).json()
        assert listing["current_quiz"] == "grade5/math.yaml"


def test_quiz_page_has_fork_elements(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        html = requests.get(f"http://localhost:{port}/").text
        assert 'id="timer"' in html
        assert 'id="nav"' in html
        assert 'id="skip-question-btn"' in html and "Пропустити питання" in html
        assert "img/background.png" in html
        assert "{{T_" not in html
        # The progress bar and the theme button were removed in this fork
        assert 'id="progress-bar"' not in html
        assert '<button class="theme-toggle"' not in html.replace("<!-- <button", "")

    with custom_webquiz_server(config={"language": "en"}, quizzes={"quiz.yaml": quiz()}) as (proc, port):
        html = requests.get(f"http://localhost:{port}/").text
        assert "Skip question" in html
        assert "{{T_" not in html


def test_background_images_served(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": quiz()}) as (proc, port):
        for name in ("background.png", "top-left.png", "top-right.png"):
            response = requests.get(f"http://localhost:{port}/img/{name}")
            assert response.status_code == 200, name
            assert response.content[:4] == b"\x89PNG"

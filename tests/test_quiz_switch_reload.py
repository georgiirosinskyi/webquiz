"""Tests for reloading open quiz pages after the admin switches or restarts the quiz.

The quiz page embeds the questions of one quiz. A page left open during a quiz switch still
shows the old questions; its requests carry the quiz version they were built for, and the
server refuses them so the page reloads instead of storing answers for the new quiz's questions.
"""

import re

import pytest
import requests

from conftest import custom_webquiz_server, get_admin_session, get_page_data


QUIZ_A = {
    "title": "Quiz A",
    "questions": [
        {"question": "A1", "options": ["a", "b"], "correct_answer": 0},
        {"question": "A2", "options": ["a", "b"], "correct_answer": 0},
    ],
}
QUIZ_B = {
    "title": "Quiz B",
    "allow_skip_questions": True,
    "questions": [
        {"question": "B1", "options": ["a", "b"], "correct_answer": 1},
        {"question": "B2", "options": ["a", "b"], "correct_answer": 1},
    ],
}


def page_version(port):
    html = requests.get(f"http://localhost:{port}/").text
    return get_page_data(html)["page"]["quizVersion"]


def current_version(port):
    response = requests.get(f"http://localhost:{port}/api/quiz-version")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"
    return response.json()["quiz_version"]


def switch(port, cookies, filename):
    response = requests.post(
        f"http://localhost:{port}/api/admin/switch-quiz", json={"quiz_filename": filename}, cookies=cookies
    )
    assert response.status_code == 200, response.text


def test_page_embeds_current_quiz_version(temp_dir):
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A, "b.yaml": QUIZ_B}) as (proc, port):
        version = page_version(port)
        assert len(version) == 16
        assert current_version(port) == version


def test_quiz_page_is_not_cached(temp_dir):
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A}) as (proc, port):
        response = requests.get(f"http://localhost:{port}/")
        assert response.headers.get("Cache-Control") == "no-cache"


def test_switch_and_restart_change_version(temp_dir):
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A, "b.yaml": QUIZ_B}) as (proc, port):
        cookies = get_admin_session(port)
        first = current_version(port)

        switch(port, cookies, "b.yaml")
        second = current_version(port)
        assert second != first
        assert page_version(port) == second
        assert "Quiz B" in requests.get(f"http://localhost:{port}/").text

        # Restarting the same quiz clears all students, so open pages must reload too
        switch(port, cookies, "b.yaml")
        assert current_version(port) != second


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/register", {"username": "late"}),
        ("put", "/api/update-registration", {"user_id": "{user_id}", "username": "x"}),
        ("post", "/api/submit-answer", {"user_id": "{user_id}", "question_id": 1, "selected_answer": 0}),
        ("post", "/api/skip-question", {"user_id": "{user_id}", "question_id": 1}),
        ("post", "/api/question-start", {"user_id": "{user_id}", "question_id": 1}),
        ("post", "/api/finish-test", {"user_id": "{user_id}"}),
        ("get", "/api/verify-user/{user_id}", None),
    ],
)
def test_requests_from_old_quiz_page_are_refused(temp_dir, method, path, body):
    """After a switch, a page of the old quiz must not register or answer in the new quiz."""
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A, "b.yaml": QUIZ_B}) as (proc, port):
        cookies = get_admin_session(port)
        old_version = page_version(port)
        switch(port, cookies, "b.yaml")
        new_version = current_version(port)

        user_id = requests.post(
            f"http://localhost:{port}/api/register", json={"username": "student"}, params={"quiz_version": new_version}
        ).json()["user_id"]
        url = f"http://localhost:{port}" + path.replace("{user_id}", user_id)
        payload = None if body is None else {k: (user_id if v == "{user_id}" else v) for k, v in body.items()}

        response = requests.request(method, url, json=payload, params={"quiz_version": old_version})
        assert response.status_code == 409, response.text
        data = response.json()
        assert data["quiz_changed"] is True
        assert data["quiz_version"] == new_version
        assert data["error"]

        # Nothing was stored for the student
        verify = requests.get(f"http://localhost:{port}/api/verify-user/{user_id}").json()
        assert verify["answered_questions"] == {}
        assert verify["skipped_questions"] == []
        assert verify["test_completed"] is False


def test_old_page_answer_not_stored_for_new_quiz(temp_dir):
    """The original problem: an old page answered question 1 of quiz A, the server stored it for quiz B."""
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A, "b.yaml": QUIZ_B}) as (proc, port):
        cookies = get_admin_session(port)
        old_version = page_version(port)
        switch(port, cookies, "b.yaml")

        response = requests.post(
            f"http://localhost:{port}/api/register", json={"username": "stale"}, params={"quiz_version": old_version}
        )
        assert response.status_code == 409
        # The student was not registered in quiz B: the username is still free
        response = requests.post(
            f"http://localhost:{port}/api/register", json={"username": "stale"}, params={"quiz_version": current_version(port)}
        )
        assert response.status_code == 200, "username must still be free"


def test_current_version_and_no_version_accepted(temp_dir):
    """Requests with the current version, and API clients that send no version, work as before."""
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A}) as (proc, port):
        version = current_version(port)
        response = requests.post(
            f"http://localhost:{port}/api/register", json={"username": "a"}, params={"quiz_version": version}
        )
        assert response.status_code == 200
        user_id = response.json()["user_id"]
        response = requests.post(
            f"http://localhost:{port}/api/submit-answer",
            json={"user_id": user_id, "question_id": 1, "selected_answer": 0},
            params={"quiz_version": version},
        )
        assert response.status_code == 200

        response = requests.post(f"http://localhost:{port}/api/register", json={"username": "b"})
        assert response.status_code == 200


def test_admin_and_other_endpoints_ignore_quiz_version(temp_dir):
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A}) as (proc, port):
        cookies = get_admin_session(port)
        response = requests.get(
            f"http://localhost:{port}/api/admin/list-quizzes", params={"quiz_version": "stale"}, cookies=cookies
        )
        assert response.status_code == 200


def test_quiz_page_reload_logic_present(temp_dir):
    """The page script sends quiz_version and polls api/quiz-version (logic tested in frontend/src/quiz/connection.test.ts)."""
    with custom_webquiz_server(quizzes={"default.yaml": QUIZ_A}) as (proc, port):
        html = requests.get(f"http://localhost:{port}/").text
        script = re.search(r'src="(ui/assets/quiz-[^"]+\.js)"', html).group(1)
        js = requests.get(f"http://localhost:{port}/{script}").text
        assert "quiz_version=" in js
        assert "api/quiz-version" in js


def test_selection_page_waits_for_quiz(temp_dir):
    """With several quizzes and no default, students see a waiting page that reloads once a quiz is selected."""
    with custom_webquiz_server(quizzes={"a.yaml": QUIZ_A, "b.yaml": QUIZ_B}) as (proc, port):
        assert current_version(port) is None
        html = requests.get(f"http://localhost:{port}/").text
        assert "api/quiz-version" in html

        switch(port, get_admin_session(port), "a.yaml")
        assert current_version(port)
        assert "Quiz A" in requests.get(f"http://localhost:{port}/").text

"""Admin overview data on /ws/admin: the current quiz and a full record per user.

initial_state carries `quiz` and `users`; every change of a user (registration, approval,
answer, skip, finish) sends `user_updated` with that user's record; a quiz switch sends
`quiz_switched` with the new quiz and an empty user list.
"""

import json

import requests
import websocket

from conftest import custom_webquiz_server, get_admin_session

QUIZ = {
    "quiz.yaml": {
        "title": "Overview Quiz",
        "time_limit": 600,
        "allow_skip_questions": True,
        "questions": [
            {"question": "Q1", "options": ["A", "B"], "correct_answer": 0, "points": 2},
            {"question": "Q2", "options": ["A", "B"], "correct_answer": 1},
        ],
    }
}


def connect(port):
    ws = websocket.create_connection(f"ws://localhost:{port}/ws/admin", timeout=5)
    initial = json.loads(ws.recv())
    assert initial["type"] == "initial_state"
    return ws, initial


def next_user_update(ws, user_id):
    """Skip other messages until the next user_updated of this user."""
    while True:
        message = json.loads(ws.recv())
        if message["type"] == "user_updated" and message["user"]["user_id"] == user_id:
            return message["user"]


def last_user_update(ws, user_id, expected_status):
    """Read updates of the user until its status is the expected one."""
    while True:
        record = next_user_update(ws, user_id)
        if record["status"] == expected_status:
            return record


def test_initial_state_has_quiz_info(temp_dir):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        ws, initial = connect(port)
        ws.close()
        quiz = initial["quiz"]
        assert quiz["filename"] == "quiz.yaml"
        assert quiz["title"] == "Overview Quiz"
        assert quiz["total_questions"] == 2
        assert quiz["total_points"] == 3
        assert quiz["time_limit"] == 600
        assert quiz["allow_skip_questions"] is True
        assert quiz["requires_approval"] is False
        assert [q["question"] for q in quiz["questions"]] == ["Q1", "Q2"]
        assert initial["users"] == []


def test_answers_update_user_record(temp_dir):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        ws, _ = connect(port)
        try:
            user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna"}).json()["user_id"]
            record = next_user_update(ws, user_id)
            assert record["username"] == "Anna"
            assert record["status"] == "in_progress"
            assert record["answered"] == 0
            assert record["remaining_seconds"] > 590
            assert record["question_order"] == [1, 2]
            assert record["live_stats"]["1"]["state"] == "think"

            requests.post(
                f"http://localhost:{port}/api/submit-answer",
                json={"user_id": user_id, "question_id": 1, "selected_answer": 0},
            )
            record = next_user_update(ws, user_id)
            assert record["answered"] == 1
            assert record["correct"] == 1
            assert record["earned_points"] == 2
            assert record["live_stats"]["1"]["state"] == "ok"

            requests.post(
                f"http://localhost:{port}/api/submit-answer",
                json={"user_id": user_id, "question_id": 2, "selected_answer": 0},
            )
            record = last_user_update(ws, user_id, "completed")
            assert record["answered"] == 2
            assert record["correct"] == 1
            assert record["earned_points"] == 2
            assert record["points_percentage"] == 67
            assert record["mark"] == 3
            assert record["remaining_seconds"] is None
            assert record["elapsed_seconds"] is not None
        finally:
            ws.close()


def test_timeout_finish_is_time_up(temp_dir):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        ws, _ = connect(port)
        try:
            user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Petro"}).json()["user_id"]
            requests.post(f"http://localhost:{port}/api/skip-question", json={"user_id": user_id, "question_id": 1})
            record = next_user_update(ws, user_id)
            record = next_user_update(ws, user_id)
            assert record["skipped"] == 1
            assert record["live_stats"]["1"]["state"] == "skip"

            requests.post(f"http://localhost:{port}/api/finish-test", json={"user_id": user_id, "reason": "timeout"})
            record = last_user_update(ws, user_id, "time_up")
            # Placeholders for unanswered questions do not count as given answers
            assert record["answered"] == 0
            assert record["earned_points"] == 0
            assert record["mark"] == 2
        finally:
            ws.close()


def test_manual_finish_is_completed(temp_dir):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        ws, _ = connect(port)
        try:
            user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Olena"}).json()["user_id"]
            requests.post(f"http://localhost:{port}/api/finish-test", json={"user_id": user_id, "reason": "manual"})
            assert last_user_update(ws, user_id, "completed")["answered"] == 0
        finally:
            ws.close()


def test_pending_user_and_approval(temp_dir):
    config = {"registration": {"approve": True, "fields": ["Class"]}}
    with custom_webquiz_server(config=config, quizzes=QUIZ) as (proc, port):
        ws, initial = connect(port)
        try:
            assert initial["quiz"]["requires_approval"] is True
            user_id = requests.post(
                f"http://localhost:{port}/api/register", json={"username": "Bohdan", "class": "5-A"}
            ).json()["user_id"]
            record = next_user_update(ws, user_id)
            assert record["status"] == "pending"
            assert record["registration_fields"] == {"class": "5-A"}
            assert record["elapsed_seconds"] is None
            assert record["remaining_seconds"] is None

            requests.put(
                f"http://localhost:{port}/api/update-registration",
                json={"user_id": user_id, "username": "Bohdan K", "class": "5-B"},
            )
            record = next_user_update(ws, user_id)
            assert record["username"] == "Bohdan K"
            assert record["registration_fields"] == {"class": "5-B"}

            requests.put(
                f"http://localhost:{port}/api/admin/approve-user",
                cookies=get_admin_session(port),
                json={"user_id": user_id},
            )
            assert last_user_update(ws, user_id, "in_progress")["remaining_seconds"] > 590
        finally:
            ws.close()

        # A new admin page gets the user in its initial state
        ws, initial = connect(port)
        ws.close()
        assert [(u["username"], u["status"]) for u in initial["users"]] == [("Bohdan K", "in_progress")]


def test_quiz_switch_sends_new_quiz_and_no_users(temp_dir):
    quizzes = {"default.yaml": QUIZ["quiz.yaml"], "other.yaml": {"title": "Other", "questions": [{"question": "X", "options": ["1", "2"], "correct_answer": 0}]}}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna"})
        ws, initial = connect(port)
        try:
            assert len(initial["users"]) == 1
            requests.post(
                f"http://localhost:{port}/api/admin/switch-quiz",
                cookies=get_admin_session(port),
                json={"quiz_filename": "other.yaml"},
            )
            while True:
                message = json.loads(ws.recv())
                if message["type"] == "quiz_switched":
                    break
            assert message["quiz"]["filename"] == "other.yaml"
            assert message["quiz"]["title"] == "Other"
            assert message["users"] == []
        finally:
            ws.close()

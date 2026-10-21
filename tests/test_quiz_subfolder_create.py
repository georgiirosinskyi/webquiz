import os
import requests
from conftest import custom_webquiz_server, get_admin_session

QUIZ_DATA = {
    "title": "Nested",
    "questions": [{"question": "2 + 2?", "options": ["3", "4"], "correct_answer": 1}],
}


def _create(port, cookies, filename):
    return requests.post(
        f"http://localhost:{port}/api/admin/create-quiz",
        cookies=cookies,
        json={"filename": filename, "mode": "wizard", "quiz_data": QUIZ_DATA},
    )


def test_create_quiz_in_new_subfolder(temp_dir):
    """Creating a quiz in a folder that does not exist yet creates the folder."""
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        response = _create(port, cookies, "grade5/algebra/math")

        assert response.status_code == 200
        assert response.json()["filename"] == "grade5/algebra/math.yaml"
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "grade5", "algebra", "math.yaml"))

        listing = requests.get(f"http://localhost:{port}/api/admin/list-quizzes", cookies=cookies).json()
        assert "grade5/algebra/math.yaml" in [q["filename"] for q in listing["quizzes"]]


def test_create_quiz_in_existing_subfolder_and_backslashes(temp_dir):
    """Backslash separators are accepted, as in the other quiz endpoints."""
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        response = _create(port, cookies, "grade6\\math")

        assert response.status_code == 200
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "grade6", "math.yaml"))


def test_create_quiz_keeps_yml_extension(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        response = _create(port, cookies, "short.yml")

        assert response.status_code == 200
        assert response.json()["filename"] == "short.yml"
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "short.yml"))


def test_create_quiz_rejects_path_traversal(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        for name in ("../escape", "a/../../escape", "/abs/escape"):
            response = _create(port, cookies, name)
            assert response.status_code == 400, name

        assert not os.path.exists("escape.yaml")


def test_create_quiz_in_subfolder_already_exists(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        assert _create(port, cookies, "grade5/math").status_code == 200
        response = _create(port, cookies, "grade5/math")

        assert response.status_code == 409


def test_rename_quiz_into_new_subfolder(temp_dir):
    """Renaming through the editor can move a quiz into a folder that does not exist yet."""
    quizzes = {"main.yaml": QUIZ_DATA, "other.yaml": QUIZ_DATA}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.put(
            f"http://localhost:{port}/api/admin/quiz/other.yaml",
            cookies=cookies,
            json={"filename": "grade7/other", "mode": "wizard", "quiz_data": QUIZ_DATA},
        )

        assert response.status_code == 200
        assert response.json()["filename"] == "grade7/other.yaml"
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "grade7", "other.yaml"))
        assert not os.path.exists(os.path.join(f"quizzes_{port}", "other.yaml"))


def test_unite_quizzes_into_new_subfolder(temp_dir):
    quizzes = {"a.yaml": QUIZ_DATA, "b.yaml": QUIZ_DATA}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)
        url = f"http://localhost:{port}/api/admin/unite-quizzes"

        response = requests.post(
            url, cookies=cookies, json={"quiz_filenames": ["a.yaml", "b.yaml"], "new_name": "united/ab"}
        )

        assert response.status_code == 200
        assert response.json()["filename"] == "united/ab.yaml"
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "united", "ab.yaml"))

        response = requests.post(
            url, cookies=cookies, json={"quiz_filenames": ["a.yaml", "b.yaml"], "new_name": "../escape"}
        )
        assert response.status_code == 400

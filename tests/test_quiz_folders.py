"""Quiz folders: POST /api/admin/create-folder and the folder list of GET /api/admin/list-quizzes."""

import os

import requests

from conftest import custom_webquiz_server, get_admin_session

QUIZ_DATA = {
    "title": "In a folder",
    "questions": [{"question": "2 + 2?", "options": ["3", "4"], "correct_answer": 1}],
}


def _create_folder(port, cookies, folder):
    return requests.post(f"http://localhost:{port}/api/admin/create-folder", cookies=cookies, json={"folder": folder})


def _listing(port, cookies):
    return requests.get(f"http://localhost:{port}/api/admin/list-quizzes", cookies=cookies).json()


def test_create_folder_lists_it_while_empty(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        response = _create_folder(port, cookies, "grade5")

        assert response.status_code == 200
        assert response.json()["folder"] == "grade5/"
        assert os.path.isdir(os.path.join(f"quizzes_{port}", "grade5"))
        assert "grade5/" in _listing(port, cookies)["folders"]


def test_create_subfolder_and_quiz_in_it(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        assert _create_folder(port, cookies, "grade5").status_code == 200
        response = _create_folder(port, cookies, "grade5\\algebra")
        assert response.status_code == 200
        assert response.json()["folder"] == "grade5/algebra/"

        created = requests.post(
            f"http://localhost:{port}/api/admin/create-quiz",
            cookies=cookies,
            json={"filename": "grade5/algebra/test", "mode": "wizard", "quiz_data": QUIZ_DATA},
        )
        assert created.status_code == 200

        listing = _listing(port, cookies)
        assert listing["folders"] == ["grade5/", "grade5/algebra/"]
        assert "grade5/algebra/test.yaml" in [quiz["filename"] for quiz in listing["quizzes"]]


def test_create_folder_that_exists(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        assert _create_folder(port, cookies, "grade5").status_code == 200
        assert _create_folder(port, cookies, "grade5/").status_code == 409


def test_create_folder_rejects_bad_names(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        for name in ("", "  ", "..", "../escape", "a/../../escape", "/abs", "C:\\abs", "a:b", "a*b", "dot.", "imgs", "attach", "imgs/x"):
            response = _create_folder(port, cookies, name)
            assert response.status_code == 400, name
            assert response.json()["error"]
        assert not os.path.exists(os.path.join(temp_dir, "escape"))


def test_folder_list_skips_images_and_attachments(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        os.makedirs(os.path.join(f"quizzes_{port}", "imgs", "nested"), exist_ok=True)
        os.makedirs(os.path.join(f"quizzes_{port}", "attach"), exist_ok=True)
        os.makedirs(os.path.join(f"quizzes_{port}", "grade7"), exist_ok=True)

        assert _listing(port, cookies)["folders"] == ["grade7/"]


def test_create_folder_requires_admin(temp_dir):
    with custom_webquiz_server() as (proc, port):
        assert requests.post(f"http://localhost:{port}/api/admin/create-folder", json={"folder": "x"}).status_code == 401


def _create_quiz(port, cookies, filename):
    return requests.post(
        f"http://localhost:{port}/api/admin/create-quiz",
        cookies=cookies,
        json={"filename": filename, "mode": "wizard", "quiz_data": QUIZ_DATA},
    )


def _rename_folder(port, cookies, folder, new_name):
    return requests.post(
        f"http://localhost:{port}/api/admin/rename-folder", cookies=cookies, json={"folder": folder, "new_name": new_name}
    )


def _delete_folder(port, cookies, folder):
    return requests.post(f"http://localhost:{port}/api/admin/delete-folder", cookies=cookies, json={"folder": folder})


def test_rename_folder_keeps_its_quizzes(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        assert _create_quiz(port, cookies, "grade5/algebra/test").status_code == 200

        response = _rename_folder(port, cookies, "grade5/algebra/", "geometry")

        assert response.status_code == 200
        assert response.json()["folder"] == "grade5/geometry/"
        listing = _listing(port, cookies)
        assert listing["folders"] == ["grade5/", "grade5/geometry/"]
        assert "grade5/geometry/test.yaml" in [quiz["filename"] for quiz in listing["quizzes"]]


def test_rename_folder_errors(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        assert _create_folder(port, cookies, "a").status_code == 200
        assert _create_folder(port, cookies, "b").status_code == 200

        assert _rename_folder(port, cookies, "a/", "b").status_code == 409  # taken
        assert _rename_folder(port, cookies, "missing/", "c").status_code == 404
        for new_name in ("", "x/y", "..", "imgs", "a:b"):
            assert _rename_folder(port, cookies, "a/", new_name).status_code == 400, new_name
        for folder in ("", "/", "../a"):
            assert _rename_folder(port, cookies, folder, "c").status_code == 400, folder
        assert os.path.isdir(os.path.join(f"quizzes_{port}", "a"))


def test_delete_folder_with_its_quizzes(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        assert _create_quiz(port, cookies, "old/inner/test").status_code == 200

        response = _delete_folder(port, cookies, "old/")

        assert response.status_code == 200
        assert response.json()["deleted_quizzes"] == 1
        assert not os.path.exists(os.path.join(f"quizzes_{port}", "old"))
        assert _listing(port, cookies)["folders"] == []
        assert _delete_folder(port, cookies, "old/").status_code == 404
        for folder in ("", "/", "..", "imgs"):
            assert _delete_folder(port, cookies, folder).status_code == 400, folder


def test_folder_of_the_active_quiz_cannot_be_renamed_or_deleted(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        assert _create_quiz(port, cookies, "live/test").status_code == 200
        switched = requests.post(
            f"http://localhost:{port}/api/admin/switch-quiz", cookies=cookies, json={"quiz_filename": "live/test.yaml"}
        )
        assert switched.status_code == 200

        assert _rename_folder(port, cookies, "live/", "other").status_code == 409
        assert _delete_folder(port, cookies, "live/").status_code == 409
        assert os.path.isfile(os.path.join(f"quizzes_{port}", "live", "test.yaml"))


def test_folder_rename_and_delete_require_admin(temp_dir):
    with custom_webquiz_server() as (proc, port):
        assert _rename_folder(port, None, "a/", "b").status_code == 401
        assert _delete_folder(port, None, "a/").status_code == 401

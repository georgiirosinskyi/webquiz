"""Export and import of the settings form: POST /api/admin/config/export and /api/admin/config/import."""

import os

import requests
import yaml

from conftest import custom_webquiz_server, get_admin_session

FORM_DATA = {
    "language": "en",
    "extra_answers_with_users_csv": True,
    "question_navigation": True,
    "registration": {
        "approve": True,
        "username_label": "ПІБ",
        "fields": ["Відділ"],
        "disabled_fields": [],
        "field_options": {"Відділ": ["перший", "другий"]},
    },
    "appearance": {"background_color": "#123456", "background_image": ""},
}


def test_export_gives_yaml_of_the_form_settings_only(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        data = {**FORM_DATA, "admin": {"master_key": "leak"}, "server": {"port": 1}}

        response = requests.post(f"http://localhost:{port}/api/admin/config/export", cookies=cookies, json={"data": data})

        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "webquiz-settings.yaml"
        assert "перший" in body["content"]  # readable, not escaped
        assert yaml.safe_load(body["content"]) == FORM_DATA


def test_export_rejects_invalid_settings(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        response = requests.post(
            f"http://localhost:{port}/api/admin/config/export",
            cookies=cookies,
            json={"data": {"registration": {"fields": "Відділ"}}},
        )
        assert response.status_code == 400
        assert response.json()["errors"]


def test_import_takes_the_form_sections_and_saves_nothing(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        config_path = f"custom_config_{port}.yaml"
        before = open(config_path, encoding="utf-8").read() if os.path.exists(config_path) else None
        content = yaml.safe_dump(
            {"server": {"port": 9999}, "admin": {"master_key": "secret"}, "registration": FORM_DATA["registration"], "language": "en"},
            allow_unicode=True,
        )

        response = requests.post(f"http://localhost:{port}/api/admin/config/import", cookies=cookies, json={"content": content})

        assert response.status_code == 200
        body = response.json()
        assert body["data"] == {"registration": FORM_DATA["registration"], "language": "en"}
        assert body["ignored"] == ["admin", "server"]
        assert "secret" not in response.text
        if before is not None:
            assert open(config_path, encoding="utf-8").read() == before


def test_import_rejects_bad_files(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        url = f"http://localhost:{port}/api/admin/config/import"

        for content in ("registration: [unclosed", "- just\n- a list\n", "", "server:\n  port: 1\n"):
            response = requests.post(url, cookies=cookies, json={"content": content})
            assert response.status_code == 400, content
            assert response.json()["error"]

        invalid = requests.post(url, cookies=cookies, json={"content": "registration:\n  fields: Відділ\n"})
        assert invalid.status_code == 400
        assert invalid.json()["errors"]


def test_export_and_import_require_admin(temp_dir):
    with custom_webquiz_server() as (proc, port):
        assert requests.post(f"http://localhost:{port}/api/admin/config/export", json={"data": {}}).status_code == 401
        assert requests.post(f"http://localhost:{port}/api/admin/config/import", json={"content": ""}).status_code == 401

"""Background of the user quiz page: config section `appearance` (color or image), editable from the admin settings."""

from pathlib import Path

import requests

from conftest import custom_webquiz_server, get_admin_session, get_page_data
from webquiz.config import DEFAULT_BACKGROUND_COLOR, load_config_from_yaml
from webquiz.server import config_form_data


def quiz_page_background(temp_dir, port):
    html = (Path(temp_dir) / f"static_{port}" / "index.html").read_text(encoding="utf-8")
    return get_page_data(html)["page"]["background"]


def test_config_defaults_to_dark_color(tmp_path):
    path = tmp_path / "webquiz.yaml"
    path.write_text("language: uk\n", encoding="utf-8")
    appearance = load_config_from_yaml(str(path)).appearance
    assert appearance.background_color == DEFAULT_BACKGROUND_COLOR
    assert appearance.background_image == ""


def test_config_loads_color_and_image(tmp_path):
    path = tmp_path / "webquiz.yaml"
    path.write_text("appearance:\n  background_color: '#ffffff'\n  background_image: /imgs/bg.jpg\n", encoding="utf-8")
    appearance = load_config_from_yaml(str(path)).appearance
    assert appearance.background_color == "#ffffff"
    assert appearance.background_image == "/imgs/bg.jpg"


def test_empty_appearance_section_uses_defaults(tmp_path):
    path = tmp_path / "webquiz.yaml"
    path.write_text("appearance:\n  background_color: ''\n  background_image:\n", encoding="utf-8")
    appearance = load_config_from_yaml(str(path)).appearance
    assert appearance.background_color == DEFAULT_BACKGROUND_COLOR
    assert appearance.background_image == ""


def test_config_form_data_has_appearance():
    assert config_form_data({})["appearance"] == {"background_color": DEFAULT_BACKGROUND_COLOR, "background_image": ""}
    data = config_form_data({"appearance": {"background_color": "#123", "background_image": "/imgs/a.png"}})
    assert data["appearance"] == {"background_color": "#123", "background_image": "/imgs/a.png"}


def test_quiz_page_gets_default_background(temp_dir):
    with custom_webquiz_server() as (proc, port):
        assert quiz_page_background(temp_dir, port) == {"color": DEFAULT_BACKGROUND_COLOR, "image": ""}


def test_quiz_page_gets_configured_background(temp_dir):
    config = {"appearance": {"background_color": "#0f2a44", "background_image": "/imgs/bg.jpg"}}
    with custom_webquiz_server(config=config) as (proc, port):
        assert quiz_page_background(temp_dir, port) == {"color": "#0f2a44", "image": "/imgs/bg.jpg"}


def test_admin_saves_background_and_quiz_page_updates(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        response = requests.put(
            f"http://localhost:{port}/api/admin/config",
            cookies=cookies,
            json={"data": {"appearance": {"background_color": "#f5f5f5", "background_image": "/imgs/photo.jpg"}}},
        )
        assert response.status_code == 200, response.text
        assert response.json()["config_data"]["appearance"] == {
            "background_color": "#f5f5f5",
            "background_image": "/imgs/photo.jpg",
        }
        # Hot reload: the quiz restart writes the page again with the new background
        assert quiz_page_background(temp_dir, port) == {"color": "#f5f5f5", "image": "/imgs/photo.jpg"}

        # The settings page shows the saved values
        page = get_page_data(requests.get(f"http://localhost:{port}/admin/settings", cookies=cookies).text)["page"]
        assert page["configData"]["appearance"]["background_image"] == "/imgs/photo.jpg"

        # Back to a plain color
        response = requests.put(
            f"http://localhost:{port}/api/admin/config",
            cookies=cookies,
            json={"data": {"appearance": {"background_color": "#141414", "background_image": ""}}},
        )
        assert response.status_code == 200
        assert quiz_page_background(temp_dir, port) == {"color": "#141414", "image": ""}


def test_rejects_invalid_background(temp_dir):
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)
        for appearance, error in [
            ({"background_color": "red"}, "appearance.background_color"),
            ({"background_color": "#12345"}, "appearance.background_color"),
            ({"background_image": 5}, "appearance.background_image"),
        ]:
            response = requests.put(
                f"http://localhost:{port}/api/admin/config", cookies=cookies, json={"data": {"appearance": appearance}}
            )
            assert response.status_code == 400, appearance
            assert any(error in message for message in response.json()["errors"]), response.json()

        response = requests.put(
            f"http://localhost:{port}/api/admin/config", cookies=cookies, json={"content": "appearance: dark\n"}
        )
        assert response.status_code == 400

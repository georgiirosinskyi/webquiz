"""Tests for pages built from frontend/ (React + antd) into webquiz/ui/.

The server reads the built HTML, injects window.__WEBQUIZ__ in place of
<!--WEBQUIZ_DATA--> and serves the hashed assets from /ui/. The pages need
`npm ci && npm run build` in frontend/ before the tests run.
"""

import json
import re

import requests

from conftest import custom_webquiz_server
from webquiz.server import UI_DATA_MARKER, render_ui_page

QUIZ = {"default.yaml": {"title": "UI Quiz", "questions": [{"question": "Q1", "options": ["A", "B"], "correct_answer": 0}]}}


def injected_data(html):
    match = re.search(r"<script>window\.__WEBQUIZ__ = (.*?);</script>", html)
    assert match, "page data is not injected"
    return json.loads(match.group(1))


def test_render_ui_page_injects_data():
    html = f"<head>{UI_DATA_MARKER}</head><body></body>"
    response = render_ui_page(html, {"language": "en", "version": "1.0"})
    assert response.status == 200
    assert response.content_type == "text/html"
    assert response.headers["Cache-Control"] == "no-cache"
    assert injected_data(response.text) == {"language": "en", "version": "1.0"}
    assert UI_DATA_MARKER not in response.text


def test_render_ui_page_escapes_script_end():
    response = render_ui_page(UI_DATA_MARKER, {"title": "</script><script>alert(1)</script>"})
    assert "</script><script>alert" not in response.text
    assert injected_data(response.text) == {"title": "</script><script>alert(1)</script>"}


def test_render_ui_page_without_build():
    response = render_ui_page(None, {})
    assert response.status == 503
    assert "npm run build" in response.text


def test_admin_page_is_built_page(temp_dir):
    with custom_webquiz_server(config={"language": "en"}, quizzes=QUIZ) as (proc, port):
        response = requests.get(f"http://localhost:{port}/admin/")
        assert response.status_code == 200
        html = response.text
        assert '<div id="root"></div>' in html
        data = injected_data(html)
        assert data["language"] == "en"
        assert data["version"]

        assets = re.findall(r'(?:src|href)="(/ui/assets/[^"]+)"', html)
        assert any(asset.endswith(".js") for asset in assets), html
        assert any(asset.endswith(".css") for asset in assets), html
        for asset in assets:
            asset_response = requests.get(f"http://localhost:{port}{asset}")
            assert asset_response.status_code == 200, asset
            assert asset_response.content


def test_ui_assets_are_public(temp_dir):
    """The assets are plain JS/CSS; only the pages themselves are restricted to the local network."""
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        html = requests.get(f"http://localhost:{port}/admin/").text
        asset = re.search(r'src="(/ui/assets/[^"]+\.js)"', html).group(1)
        response = requests.get(f"http://localhost:{port}{asset}", headers={"X-Forwarded-For": "8.8.8.8"})
        assert response.status_code == 200


def test_admin_sections_serve_the_admin_app(temp_dir):
    """/admin/{section} and the old /files/ URL serve the same admin app with all its page data."""
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin = injected_data(requests.get(f"http://localhost:{port}/admin/").text)
        for path in ["/admin/quizzes", "/admin/files", "/admin/settings", "/admin/access", "/admin/projector", "/files/"]:
            response = requests.get(f"http://localhost:{port}{path}")
            assert response.status_code == 200, path
            data = injected_data(response.text)
            assert data["page"].keys() == admin["page"].keys(), path
            assert "configContent" in data["page"] and "networkUrls" in data["page"]


def test_admin_page_data_for_the_projector(temp_dir):
    """The projector page is static: the current quiz title comes with the page (only local addresses)."""
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        data = injected_data(requests.get(f"http://localhost:{port}/admin/projector").text)["page"]
        assert data["currentQuizTitle"] == "UI Quiz"
        assert "publicUrl" not in data
        # One local address (or none on a computer without network interfaces)
        assert data["projectorUrl"] is None or data["projectorUrl"] in data["networkUrls"]
        assert isinstance(data["networkUrls"], list)


def test_admin_sections_are_local_only(temp_dir):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        response = requests.get(f"http://localhost:{port}/admin/settings", headers={"X-Forwarded-For": "8.8.8.8"})
        assert response.status_code == 403

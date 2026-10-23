"""Config option `question_navigation`: the numbered question bar on the quiz page when skipping is off."""

from pathlib import Path

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server, get_admin_session, get_page_data
from selenium_helpers import browser, register_user, skip_if_selenium_disabled
from webquiz.config import load_config_from_yaml
from webquiz.server import config_form_data

QUIZ = {
    "title": "Navigation",
    "questions": [
        {"question": "Q1", "options": ["A", "B"], "correct_answer": 0},
        {"question": "Q2", "options": ["C", "D"], "correct_answer": 1},
    ],
}


def quiz_page(temp_dir, port):
    html = (Path(temp_dir) / f"static_{port}" / "index.html").read_text(encoding="utf-8")
    return get_page_data(html)["page"]


def test_config_defaults_to_no_navigation(tmp_path):
    path = tmp_path / "webquiz.yaml"
    path.write_text("language: uk\n", encoding="utf-8")
    assert load_config_from_yaml(str(path)).question_navigation is False
    path.write_text("question_navigation: true\n", encoding="utf-8")
    assert load_config_from_yaml(str(path)).question_navigation is True


def test_config_form_data_has_navigation():
    assert config_form_data({})["question_navigation"] is False
    assert config_form_data({"question_navigation": True})["question_navigation"] is True


def test_quiz_page_gets_navigation_setting(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        assert quiz_page(temp_dir, port)["questionNavigation"] is False
    with custom_webquiz_server(config={"question_navigation": True}, quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        assert quiz_page(temp_dir, port)["questionNavigation"] is True


def test_admin_turns_navigation_on(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        cookies = get_admin_session(port)
        response = requests.put(
            f"http://localhost:{port}/api/admin/config", cookies=cookies, json={"data": {"question_navigation": True}}
        )
        assert response.status_code == 200, response.text
        assert response.json()["config_data"]["question_navigation"] is True
        # Hot reload: the quiz restart writes the page again
        assert quiz_page(temp_dir, port)["questionNavigation"] is True


def test_rejects_non_boolean_navigation(temp_dir):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        response = requests.put(
            f"http://localhost:{port}/api/admin/config",
            cookies=get_admin_session(port),
            json={"data": {"question_navigation": "sometimes"}},
        )
        assert response.status_code == 400
        assert any("question_navigation" in message for message in response.json()["errors"])


def nav_buttons(browser):
    return browser.find_elements(By.CSS_SELECTOR, "#nav .q-btn")


@skip_if_selenium_disabled
def test_no_navigation_by_default(browser):
    with custom_webquiz_server(quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        register_user(browser, port)
        WebDriverWait(browser, 10).until(lambda d: d.find_elements(By.ID, "option_0"))
        assert nav_buttons(browser) == []


@skip_if_selenium_disabled
def test_navigation_when_enabled(browser):
    with custom_webquiz_server(config={"question_navigation": True}, quizzes={"quiz.yaml": QUIZ}) as (proc, port):
        register_user(browser, port)
        WebDriverWait(browser, 10).until(lambda d: len(nav_buttons(d)) == 2)


@skip_if_selenium_disabled
def test_navigation_always_shown_with_skipping(browser):
    with custom_webquiz_server(quizzes={"quiz.yaml": {**QUIZ, "allow_skip_questions": True}}) as (proc, port):
        register_user(browser, port)
        WebDriverWait(browser, 10).until(lambda d: len(nav_buttons(d)) == 2)

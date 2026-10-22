"""
Selenium tests for entering decimal question points in the admin quiz editor.

Verifies the points input accepts values like 0.5 and 0.25, that the editor
saves them, that they are still there when the quiz is reopened, and that bad
values block the save with a message naming the question.
"""

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server, get_admin_session
from selenium_helpers import (
    skip_if_selenium_disabled,
    browser,
    admin_login,
    open_quiz_editor,
    expand_question,
    click_js,
    clear_input,
    message_texts,
)

QUIZ = {
    "default.yaml": {
        "title": "Editor Points Quiz",
        "questions": [
            {"question": "Q1", "options": ["A", "B"], "correct_answer": 0},
            {"question": "Q2", "options": ["A", "B"], "correct_answer": 1},
        ],
    }
}


def points_input(browser, index):
    return expand_question(browser, index).find_element(By.CSS_SELECTOR, ".points-input")


def set_points(browser, index, value):
    field = points_input(browser, index)
    browser.execute_script("arguments[0].scrollIntoView({block: 'center'});", field)
    clear_input(field)
    field.send_keys(value)
    return field


def click_save(browser):
    click_js(browser, browser.find_element(By.CSS_SELECTOR, '[data-testid="save-quiz"]'))


def editor_open(browser):
    return bool(browser.find_elements(By.CSS_SELECTOR, ".ant-modal-wrap .question-item"))


def save_quiz(browser):
    click_save(browser)
    WebDriverWait(browser, 10).until(lambda d: not editor_open(d))


def quiz_content(port):
    cookies = get_admin_session(port)
    return requests.get(f"http://localhost:{port}/api/admin/quiz/default.yaml", cookies=cookies).json()["content"]


@skip_if_selenium_disabled
def test_points_input_accepts_decimal_values(browser):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        field = set_points(browser, 0, "0.25")
        assert field.get_attribute("value") == "0.25", "Input should hold the decimal value"


@skip_if_selenium_disabled
def test_editor_saves_decimal_points(browser):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        set_points(browser, 0, "0.5")
        set_points(browser, 1, "0.25")
        save_quiz(browser)

        content = quiz_content(port)
        assert "points: 0.5" in content, f"0.5 was not saved. Quiz file:\n{content}"
        assert "points: 0.25" in content, f"0.25 was not saved. Quiz file:\n{content}"


@skip_if_selenium_disabled
def test_decimal_points_reload_into_editor(browser):
    quiz = {
        "default.yaml": {
            "title": "Stored Points Quiz",
            "questions": [
                {"question": "Q1", "options": ["A", "B"], "correct_answer": 0, "points": 0.25},
                {"question": "Q2", "options": ["A", "B"], "correct_answer": 1, "points": 2.5},
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        values = [points_input(browser, i).get_attribute("value") for i in range(2)]
        assert values == ["0.25", "2.5"], values


@skip_if_selenium_disabled
def test_more_than_two_decimals_shows_error(browser):
    """Typing 0.255 is refused with a message instead of being rounded silently."""
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        set_points(browser, 0, "0.255")
        click_save(browser)

        WebDriverWait(browser, 10).until(lambda d: message_texts(d))
        message = " ".join(message_texts(browser))
        assert "Питання 1" in message, f"Error should name the question, got: {message}"
        assert "2 знак" in message, f"Error should mention the 2 decimal limit, got: {message}"
        assert editor_open(browser), "Editor should stay open"
        assert "points:" not in quiz_content(port), "Quiz should not have been saved"


@skip_if_selenium_disabled
def test_zero_points_shows_error(browser):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        set_points(browser, 0, "0")
        click_save(browser)

        WebDriverWait(browser, 10).until(lambda d: message_texts(d))
        message = " ".join(message_texts(browser))
        assert "Питання 1" in message, f"Error should name the question, got: {message}"
        assert editor_open(browser), "Editor should stay open"


@skip_if_selenium_disabled
def test_two_decimals_still_saves(browser):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "default.yaml")
        set_points(browser, 0, "0.25")
        save_quiz(browser)
        assert not message_texts(browser), f"No error expected, got: {message_texts(browser)}"

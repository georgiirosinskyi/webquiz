"""
Selenium tests for the admin quiz editor (built from frontend/src/admin).

Tests verify:
1. Questions are collapsed by default when editing an existing quiz
2. Clicking on a question header toggles the collapsed state
3. New questions added are expanded by default
4. Question preview text, number and image/file indicators are in the header
5. Drag handle is present for reordering
6. "Save and Continue" keeps the editor open
7. Settings the editor does not show (marks, ...) survive a save
"""

import requests
import yaml
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server, get_admin_session
from selenium_helpers import (
    skip_if_selenium_disabled,
    browser,
    wait_for_element,
    admin_login,
    open_quiz_editor,
    question_items,
    click_js,
    clear_input,
    expand_question,
    wait_for_modal,
)


def body_hidden(item):
    return not item.find_element(By.CSS_SELECTOR, ".ant-card-body").is_displayed()


def quiz_file(port, filename):
    cookies = get_admin_session(port)
    return requests.get(f"http://localhost:{port}/api/admin/quiz/{filename}", cookies=cookies).json()["content"]


def click_button(browser, text):
    click_js(browser, browser.find_element(By.XPATH, f"//button[contains(., '{text}')]"))


@skip_if_selenium_disabled
def test_questions_collapsed_when_editing_quiz(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Collapsible Test Quiz",
            "questions": [
                {"question": "Question 1 text here", "options": ["A", "B"], "correct_answer": 0},
                {"question": "Question 2 text here", "options": ["C", "D"], "correct_answer": 1},
                {"question": "Question 3 text here", "options": ["E", "F"], "correct_answer": 0},
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")

        items = question_items(browser)
        assert len(items) == 3, f"Expected 3 questions, found {len(items)}"
        for i, item in enumerate(items):
            assert "collapsed" in item.get_attribute("class"), f"Question {i+1} should be collapsed"
            assert body_hidden(item), f"Question {i+1} body should be hidden"


@skip_if_selenium_disabled
def test_click_header_toggles_collapse(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Toggle Test Quiz",
            "questions": [{"question": "Toggle question text", "options": ["Yes", "No"], "correct_answer": 0}],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")

        header = question_items(browser)[0].find_element(By.CSS_SELECTOR, ".question-preview")
        click_js(browser, header)
        WebDriverWait(browser, 5).until(lambda d: "collapsed" not in question_items(d)[0].get_attribute("class"))
        assert not body_hidden(question_items(browser)[0])

        click_js(browser, question_items(browser)[0].find_element(By.CSS_SELECTOR, ".question-preview"))
        WebDriverWait(browser, 5).until(lambda d: "collapsed" in question_items(d)[0].get_attribute("class"))


@skip_if_selenium_disabled
def test_new_question_is_expanded(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "New Question Test",
            "questions": [{"question": "Existing question", "options": ["A", "B"], "correct_answer": 0}],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")

        click_button(browser, "Додати питання")
        WebDriverWait(browser, 5).until(lambda d: len(question_items(d)) == 2)

        items = question_items(browser)
        assert "collapsed" in items[0].get_attribute("class"), "Existing question should remain collapsed"
        assert "collapsed" not in items[1].get_attribute("class"), "New question should be expanded"


@skip_if_selenium_disabled
def test_header_shows_number_preview_and_indicators(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Indicators Test Quiz",
            "questions": [
                {"question": "What is the capital of Ukraine?", "image": "/imgs/test.png", "options": ["A", "B"], "correct_answer": 0},
                {"question": "Question with file", "file": "data.xlsx", "options": ["C", "D"], "correct_answer": 0},
                {"question": "Both", "image": "/imgs/pic.jpg", "file": "doc.pdf", "options": ["E", "F"], "correct_answer": 0, "points": 2},
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")
        items = question_items(browser)

        assert [item.find_element(By.CSS_SELECTOR, ".question-number").text for item in items] == ["1.", "2.", "3."]
        assert "What is the capital of Ukraine?" in items[0].find_element(By.CSS_SELECTOR, ".question-preview").text

        indicators = [item.find_element(By.CSS_SELECTOR, ".question-indicators").text for item in items]
        assert "🖼" in indicators[0], indicators
        assert "📎" in indicators[1], indicators
        assert "🖼" in indicators[2] and "📎" in indicators[2] and "🏆2" in indicators[2], indicators

        for item in items:
            assert item.find_element(By.CSS_SELECTOR, ".drag-handle").is_displayed()


@skip_if_selenium_disabled
def test_save_and_continue_keeps_editor_open(temp_dir, browser):
    with custom_webquiz_server() as (proc, port):
        admin_login(browser, port)
        click_js(browser, browser.find_element(By.CSS_SELECTOR, '[data-testid="create-btn"]'))
        wait_for_modal(browser)
        wait_for_element(browser, By.ID, "quiz-filename").send_keys("test_save_continue")
        browser.find_element(By.ID, "quiz-title").send_keys("Save and Continue Test")

        # A new quiz starts with one empty, expanded question with 4 options
        item = question_items(browser)[0]
        item.find_element(By.CSS_SELECTOR, ".question-text").send_keys("Test question")
        options = item.find_elements(By.CSS_SELECTOR, ".option-text")
        assert len(options) == 4
        for option, text in zip(options, ["Option A", "Option B", "Option C", "Option D"]):
            option.send_keys(text)

        save_continue = browser.find_element(By.CSS_SELECTOR, '[data-testid="save-continue"]')
        click_js(browser, save_continue)
        WebDriverWait(browser, 5).until(lambda d: "Збережено" in save_continue.text)
        WebDriverWait(browser, 5).until(lambda d: "продовжити" in save_continue.text)

        # The editor stays open and now edits the saved file
        assert "Редагування тесту" in browser.find_element(By.CSS_SELECTOR, ".ant-modal-title").text
        assert browser.find_element(By.ID, "quiz-filename").is_enabled()

        saved = yaml.safe_load(quiz_file(port, "test_save_continue.yaml"))
        assert saved["title"] == "Save and Continue Test"
        assert saved["questions"] == [
            {"question": "Test question", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_answer": 0}
        ]


@skip_if_selenium_disabled
def test_save_and_continue_in_edit_mode(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Existing Quiz",
            "questions": [{"question": "Original question", "options": ["A", "B"], "correct_answer": 0}],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")

        title = browser.find_element(By.ID, "quiz-title")
        clear_input(title)
        title.send_keys("Modified Title")

        save_continue = browser.find_element(By.CSS_SELECTOR, '[data-testid="save-continue"]')
        click_js(browser, save_continue)
        WebDriverWait(browser, 5).until(lambda d: "Збережено" in save_continue.text)

        assert browser.find_element(By.ID, "quiz-title").get_attribute("value") == "Modified Title"
        assert yaml.safe_load(quiz_file(port, "test_quiz.yaml"))["title"] == "Modified Title"


@skip_if_selenium_disabled
def test_editor_keeps_settings_it_does_not_show(temp_dir, browser):
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Graded",
            "time_limit": 300,
            "marks": [{"grade": 12, "min_score": 90}],
            "default_mark": 1,
            "questions": [{"question": "Q", "options": ["A", "B"], "correct_answer": 1, "custom": "kept"}],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        admin_login(browser, port)
        open_quiz_editor(browser, "test_quiz.yaml")
        assert browser.find_element(By.ID, "time-limit").get_attribute("value") == "300"

        option = expand_question(browser, 0).find_elements(By.CSS_SELECTOR, ".option-text")[0]
        clear_input(option)
        option.send_keys("A2")
        click_js(browser, browser.find_element(By.CSS_SELECTOR, '[data-testid="save-quiz"]'))
        WebDriverWait(browser, 10).until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".ant-modal-wrap .question-item"))

        saved = yaml.safe_load(quiz_file(port, "test_quiz.yaml"))
        assert saved["marks"] == [{"grade": 12, "min_score": 90}]
        assert saved["default_mark"] == 1
        assert saved["time_limit"] == 300
        assert saved["questions"][0] == {"question": "Q", "options": ["A2", "B"], "correct_answer": 1, "custom": "kept"}

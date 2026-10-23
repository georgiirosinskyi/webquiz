"""Selenium: with show_answers_on_completion the results page opens the correct answers by itself."""

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server
from selenium_helpers import browser, register_user, skip_if_selenium_disabled, wait_for_results

QUIZ = {
    "default.yaml": {
        "title": "Answers Later",
        "show_right_answer": False,
        "show_answers_on_completion": True,
        "questions": [{"question": "What is 2 + 2?", "options": ["3", "4"], "correct_answer": 1}],
    }
}


@skip_if_selenium_disabled
def test_results_page_shows_answers_when_everyone_finished(temp_dir, browser):
    with custom_webquiz_server(quizzes=QUIZ) as (proc, port):
        # Another user has not finished yet, so the answers stay hidden
        other_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Other"}).json()["user_id"]

        register_user(browser, port, "Anna")
        browser.find_element(By.ID, "option_0").click()
        browser.find_element(By.ID, "submit-answer-btn").click()
        wait_for_results(browser)

        notice = browser.find_element(By.CSS_SELECTOR, ".answers-later")
        assert "Сторінка оновиться автоматично" in notice.text
        assert not browser.find_elements(By.XPATH, "//button[contains(., 'Перезавантажити')]")
        assert "Правильна:" not in browser.find_element(By.ID, "results-content").text

        requests.post(
            f"http://localhost:{port}/api/submit-answer",
            json={"user_id": other_id, "question_id": 1, "selected_answer": 1},
        )

        # The page polls every 5 s and shows the answers without a reload
        browser.execute_script("window.__notReloaded = true")
        WebDriverWait(browser, 15).until(lambda d: not d.find_elements(By.CSS_SELECTOR, ".answers-later"))
        results = browser.find_element(By.ID, "results-content").text
        assert "Правильна:" in results
        assert "✗" in results
        assert browser.execute_script("return window.__notReloaded") is True

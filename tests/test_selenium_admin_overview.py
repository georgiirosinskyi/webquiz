"""Selenium tests for the admin app shell and its Overview section (frontend/src/admin)."""

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server
from selenium_helpers import admin_login, browser, skip_if_selenium_disabled, wait_for_element


def user_status(browser, username):
    rows = browser.find_elements(By.XPATH, f"//div[@data-testid='users-table']//tr[.//*[text()='{username}']]")
    if not rows:
        return None
    return rows[0].find_element(By.CSS_SELECTOR, '[data-testid="user-status"]').get_attribute("data-status")


@skip_if_selenium_disabled
def test_overview_shows_users_live_and_approves(temp_dir, browser):
    config = {"registration": {"approve": True, "fields": ["Class"]}}
    with custom_webquiz_server(config=config) as (proc, port):
        admin_login(browser, port, section="")
        title = wait_for_element(browser, By.CSS_SELECTOR, '[data-testid="current-quiz-title"]')
        WebDriverWait(browser, 10).until(lambda d: title.text == "Test Quiz")

        requests.post(f"http://localhost:{port}/api/register", json={"username": "Anna", "class": "5-A"})
        WebDriverWait(browser, 10).until(lambda d: user_status(d, "Anna") == "pending")
        assert "5-A" in browser.find_element(By.CSS_SELECTOR, '[data-testid="users-table"]').text

        browser.find_element(By.CSS_SELECTOR, '[data-testid="approve-btn"]').click()
        WebDriverWait(browser, 10).until(lambda d: user_status(d, "Anna") == "in_progress")


@skip_if_selenium_disabled
def test_overview_shows_progress_and_grade(temp_dir, browser):
    with custom_webquiz_server() as (proc, port):
        admin_login(browser, port, section="")
        user_id = requests.post(f"http://localhost:{port}/api/register", json={"username": "Petro"}).json()["user_id"]
        WebDriverWait(browser, 10).until(lambda d: user_status(d, "Petro") == "in_progress")

        requests.post(
            f"http://localhost:{port}/api/submit-answer",
            json={"user_id": user_id, "question_id": 1, "selected_answer": 1},
        )
        WebDriverWait(browser, 10).until(lambda d: user_status(d, "Petro") == "completed")
        row = browser.find_element(By.XPATH, "//div[@data-testid='users-table']//tr[.//*[text()='Petro']]")
        assert "1/1" in row.text
        assert "✓ 1" in row.find_element(By.CSS_SELECTOR, '[data-testid="progress-summary"]').text


@skip_if_selenium_disabled
def test_menu_switches_sections_without_reload(temp_dir, browser):
    with custom_webquiz_server() as (proc, port):
        admin_login(browser, port, section="")
        wait_for_element(browser, By.CSS_SELECTOR, '[data-testid="overview"]')
        browser.execute_script("window.__notReloaded = true")

        browser.find_element(By.XPATH, "//li[contains(@class,'ant-menu-item')][contains(., 'Тести')]").click()
        wait_for_element(browser, By.CSS_SELECTOR, '[data-testid="quiz-list"]')
        assert browser.current_url.endswith("/admin/quizzes")

        browser.find_element(By.XPATH, "//li[contains(@class,'ant-menu-item')][contains(., 'Файли')]").click()
        wait_for_element(browser, By.CSS_SELECTOR, '[data-testid="files-panel"]')
        assert browser.current_url.endswith("/admin/files")

        browser.back()
        wait_for_element(browser, By.CSS_SELECTOR, '[data-testid="quiz-list"]')
        assert browser.execute_script("return window.__notReloaded") is True

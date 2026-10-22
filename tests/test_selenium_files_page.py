"""Selenium tests for the file manager page (built from frontend/src/files)."""

import requests
import yaml
from selenium.common.exceptions import ElementClickInterceptedException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server, get_admin_session, get_page_data
from selenium_helpers import skip_if_selenium_disabled, browser


def login(browser, base_url):
    browser.get(f"{base_url}/files/")
    browser.find_element(By.ID, "master-key").send_keys("test123")
    browser.find_element(By.XPATH, "//button[.//span[text()='Login']]").click()
    WebDriverWait(browser, 10).until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-testid="files-panel"]'))


def click_tab(browser, label):
    browser.find_element(By.XPATH, f"//div[@role='tab'][contains(., '{label}')]").click()


@skip_if_selenium_disabled
def test_login_and_edit_quiz(browser):
    with custom_webquiz_server() as (proc, port):
        base_url = f"http://localhost:{port}"
        login(browser, base_url)

        click_tab(browser, "Quiz Files")
        row = WebDriverWait(browser, 10).until(
            lambda d: d.find_element(By.XPATH, "//tr[.//*[text()='test_quiz.yaml']]")
        )
        row.find_element(By.XPATH, ".//button[contains(., 'Edit')]").click()

        editor = WebDriverWait(browser, 10).until(lambda d: d.find_element(By.ID, "quiz-editor-content"))
        WebDriverWait(browser, 10).until(lambda d: "What is 2 + 2?" in editor.get_attribute("value"))

        # Clicks are intercepted while the modal is still animating in
        validate = browser.find_element(By.XPATH, "//button[contains(., 'Validate YAML')]")
        WebDriverWait(browser, 10, ignored_exceptions=[ElementClickInterceptedException]).until(
            lambda d: validate.click() or True
        )
        WebDriverWait(browser, 10).until(lambda d: "Found 1 questions" in d.page_source)


@skip_if_selenium_disabled
def test_config_form_saves_registration_fields(browser):
    with custom_webquiz_server(config={"registration": {"fields": ["Grade"], "disabled_fields": ["School"]}}) as (
        proc,
        port,
    ):
        base_url = f"http://localhost:{port}"
        login(browser, base_url)
        click_tab(browser, "Config")

        fields = WebDriverWait(browser, 10).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, '[data-testid="cfg-reg-fields-list"] input[type="text"]')
        )
        assert [field.get_attribute("value") for field in fields] == ["Grade", "School"]

        # Enable approval and the disabled "School" field
        browser.find_element(By.ID, "cfg-reg-approve").click()
        checkboxes = browser.find_elements(By.CSS_SELECTOR, '[data-testid="cfg-reg-fields-list"] input[type="checkbox"]')
        checkboxes[1].click()
        browser.find_element(By.XPATH, "//button[contains(., 'Save Configuration')]").click()
        WebDriverWait(browser, 15).until(lambda d: d.find_elements(By.CSS_SELECTOR, ".ant-alert-success"))

        cookies = get_admin_session(port)
        html = requests.get(f"{base_url}/files/", cookies=cookies).text
        registration = yaml.safe_load(get_page_data(html)["page"]["configContent"])["registration"]
        assert registration["approve"] is True
        assert registration["fields"] == ["Grade", "School"]
        assert registration["disabled_fields"] == []

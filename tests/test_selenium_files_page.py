"""Selenium tests for the Archive and Settings sections of the admin app (frontend/src/files)."""

import requests
import yaml
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import custom_webquiz_server, get_admin_session, get_page_data
from selenium_helpers import skip_if_selenium_disabled, browser


def login(browser, base_url, path="/files/", ready='[data-testid="archive-table"]'):
    browser.get(f"{base_url}{path}")
    browser.find_element(By.ID, "master-key").send_keys("test123")
    browser.find_element(By.XPATH, "//button[@type='submit']").click()
    WebDriverWait(browser, 10).until(lambda d: d.find_elements(By.CSS_SELECTOR, ready))


@skip_if_selenium_disabled
def test_archive_shows_run_and_its_csv(browser):
    # The English admin pages; the old /files/ address opens the archive
    with custom_webquiz_server(config={"language": "en"}) as (proc, port):
        base_url = f"http://localhost:{port}"
        user_id = requests.post(f"{base_url}/api/register", json={"username": "Olena"}).json()["user_id"]
        requests.post(f"{base_url}/api/submit-answer", json={"user_id": user_id, "question_id": 1, "selected_answer": 1})
        login(browser, base_url)

        row = WebDriverWait(browser, 10).until(
            lambda d: d.find_element(By.XPATH, "//div[@data-testid='archive-table']//tr[.//*[text()='Test Quiz']]")
        )
        assert "100%" in row.text  # one correct answer of one
        row.click()
        files = WebDriverWait(browser, 10).until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-testid="archive-files"]'))
        users_row = files.find_element(By.CSS_SELECTOR, '[data-testid="archive-file"][data-file="users.csv"]')
        users_row.find_element(By.XPATH, ".//button[contains(., 'View')]").click()

        WebDriverWait(browser, 10).until(
            lambda d: "Olena" in d.find_element(By.CSS_SELECTOR, '[data-testid="csv-table"]').get_attribute("textContent")
        )


@skip_if_selenium_disabled
def test_config_form_saves_registration_fields(browser):
    with custom_webquiz_server(config={"registration": {"fields": ["Grade"], "disabled_fields": ["School"]}}) as (
        proc,
        port,
    ):
        base_url = f"http://localhost:{port}"
        login(browser, base_url, "/admin/settings", '[data-testid="cfg-reg-fields-list"]')

        fields = WebDriverWait(browser, 10).until(
            lambda d: d.find_elements(By.CSS_SELECTOR, '[data-testid="cfg-reg-fields-list"] input[type="text"]')
        )
        assert [field.get_attribute("value") for field in fields] == ["Grade", "School"]

        # Enable approval and the disabled "School" field
        browser.find_element(By.ID, "cfg-reg-approve").click()
        checkboxes = browser.find_elements(By.CSS_SELECTOR, '[data-testid="cfg-reg-fields-list"] input[type="checkbox"]')
        checkboxes[1].click()
        browser.find_element(By.XPATH, "//button[contains(., 'Зберегти налаштування')]").click()
        WebDriverWait(browser, 15).until(lambda d: d.find_elements(By.CSS_SELECTOR, ".ant-alert-success"))

        cookies = get_admin_session(port)
        html = requests.get(f"{base_url}/files/", cookies=cookies).text
        registration = yaml.safe_load(get_page_data(html)["page"]["configContent"])["registration"]
        assert registration["approve"] is True
        assert registration["fields"] == ["Grade", "School"]
        assert registration["disabled_fields"] == []


@skip_if_selenium_disabled
def test_settings_form_sets_quiz_background(browser):
    with custom_webquiz_server() as (proc, port):
        base_url = f"http://localhost:{port}"
        login(browser, base_url, "/admin/settings", '[data-testid="cfg-background"]')

        # Image mode shows the image field; the preview follows the form
        browser.find_element(By.XPATH, "//div[@data-testid='cfg-background']//label[contains(., 'Зображення')]").click()
        image = WebDriverWait(browser, 10).until(lambda d: d.find_element(By.ID, "cfg-background-image"))
        image.send_keys("/imgs/bg.jpg")
        preview = browser.find_element(By.CSS_SELECTOR, '[data-testid="cfg-background-preview"]')
        WebDriverWait(browser, 10).until(lambda d: "imgs/bg.jpg" in preview.get_attribute("style"))

        browser.find_element(By.XPATH, "//button[contains(., 'Зберегти налаштування')]").click()
        WebDriverWait(browser, 15).until(lambda d: d.find_elements(By.CSS_SELECTOR, ".ant-alert-success"))

        html = requests.get(f"{base_url}/admin/settings", cookies=get_admin_session(port)).text
        appearance = yaml.safe_load(get_page_data(html)["page"]["configContent"])["appearance"]
        assert appearance == {"background_color": "#1f2937", "background_image": "/imgs/bg.jpg"}

        # The quiz page uses it
        browser.get(f"{base_url}/")
        WebDriverWait(browser, 10).until(lambda d: d.find_element(By.ID, "username"))
        body_image = browser.execute_script("return document.body.style.backgroundImage")
        assert "imgs/bg.jpg" in body_image


@skip_if_selenium_disabled
def test_quiz_page_has_dark_background_by_default(browser):
    with custom_webquiz_server() as (proc, port):
        browser.get(f"http://localhost:{port}/")
        WebDriverWait(browser, 10).until(lambda d: d.find_element(By.ID, "username"))
        color = browser.execute_script("return getComputedStyle(document.body).backgroundColor")
        assert color == "rgb(31, 41, 55)"
        assert browser.execute_script("return document.body.style.backgroundImage") == ""
        assert "dark-background" in browser.find_element(By.TAG_NAME, "body").get_attribute("class")

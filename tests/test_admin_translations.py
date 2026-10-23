"""Admin API messages follow the `language` config option (ADMIN_TRANSLATIONS in webquiz/translations.py)."""

import string

import requests

from conftest import custom_webquiz_server, get_admin_session
from webquiz.translations import ADMIN_TRANSLATIONS, TRANSLATIONS, admin_text


def placeholders(text):
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}


def test_both_languages_have_the_same_messages_and_placeholders():
    uk, en = ADMIN_TRANSLATIONS["uk"], ADMIN_TRANSLATIONS["en"]
    assert set(uk) == set(en)
    for key in uk:
        assert uk[key].strip() and en[key].strip(), key
        assert placeholders(uk[key]) == placeholders(en[key]), key


def test_quiz_page_texts_are_translated():
    assert set(TRANSLATIONS["uk"]) == set(TRANSLATIONS["en"])
    # These used to be English in the Ukrainian set
    assert TRANSLATIONS["uk"]["server_update_not_found"] == "Користувача не знайдено"
    assert TRANSLATIONS["uk"]["server_update_after_approval"] != TRANSLATIONS["en"]["server_update_after_approval"]


def test_admin_text_fills_placeholders_and_falls_back_to_ukrainian():
    assert admin_text("en", "quiz_deleted", name="a.yaml") == 'Quiz "a.yaml" deleted successfully'
    assert admin_text("uk", "quiz_deleted", name="a.yaml") == 'Тест "a.yaml" видалено'
    assert admin_text("de", "quiz_not_found") == ADMIN_TRANSLATIONS["uk"]["quiz_not_found"]


def admin_errors(port):
    cookies = get_admin_session(port)
    missing = requests.delete(f"http://localhost:{port}/api/admin/quiz/missing.yaml", cookies=cookies).json()
    invalid = requests.put(
        f"http://localhost:{port}/api/admin/config", cookies=cookies, json={"data": {"language": "de"}}
    ).json()
    return missing["error"], invalid


def test_admin_messages_in_ukrainian_by_default(temp_dir):
    with custom_webquiz_server() as (proc, port):
        missing, invalid = admin_errors(port)
        assert missing == "Файл тесту не знайдено"
        assert invalid["error"] == "Конфігурація не пройшла перевірку"
        assert invalid["errors"] == ["'language' має бути 'uk' або 'en'"]


def test_admin_messages_in_english(temp_dir):
    with custom_webquiz_server(config={"language": "en"}) as (proc, port):
        missing, invalid = admin_errors(port)
        assert missing == "Quiz file not found"
        assert invalid["error"] == "Configuration validation failed"
        assert invalid["errors"] == ["'language' must be 'uk' or 'en'"]

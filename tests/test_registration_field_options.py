"""Registration fields with a fixed list of values (registration.field_options): a choice instead of free text."""

import json

import requests
import websocket

from conftest import custom_webquiz_server, get_admin_session, get_page_data

LEVELS = ["перший", "другий", "третій"]
CONFIG = {"registration": {"approve": True, "fields": ["Рівень", "Підрозділ"], "field_options": {"Рівень": LEVELS}}}


def test_quiz_page_gets_the_values_in_their_order(temp_dir):
    with custom_webquiz_server(config=CONFIG) as (proc, port):
        page = get_page_data(requests.get(f"http://localhost:{port}/").text)

        assert page["page"]["registrationFields"] == [
            {"label": "Рівень", "name": "рівень", "options": LEVELS},
            {"label": "Підрозділ", "name": "підрозділ"},
        ]


def test_register_accepts_only_a_value_from_the_list(temp_dir):
    with custom_webquiz_server(config=CONFIG) as (proc, port):
        url = f"http://localhost:{port}/api/register"

        wrong = requests.post(url, json={"username": "Ann", "рівень": "десятий", "підрозділ": "1"})
        assert wrong.status_code == 400
        assert "Рівень" in wrong.json()["error"]

        right = requests.post(url, json={"username": "Ann", "рівень": "другий", "підрозділ": "1"})
        assert right.status_code == 200


def test_update_registration_accepts_only_a_value_from_the_list(temp_dir):
    with custom_webquiz_server(config=CONFIG) as (proc, port):
        user_id = requests.post(
            f"http://localhost:{port}/api/register", json={"username": "Ann", "рівень": "перший", "підрозділ": "1"}
        ).json()["user_id"]
        url = f"http://localhost:{port}/api/update-registration"

        assert requests.put(url, json={"user_id": user_id, "рівень": "сотий"}).status_code == 400
        assert requests.put(url, json={"user_id": user_id, "рівень": "третій"}).status_code == 200
        user_data = requests.get(f"http://localhost:{port}/api/verify-user/{user_id}").json()["user_data"]
        assert user_data["рівень"] == "третій"


def test_admin_overview_gets_the_values_for_sorting(temp_dir):
    with custom_webquiz_server(config=CONFIG) as (proc, port):
        ws = websocket.create_connection(f"ws://localhost:{port}/ws/admin", timeout=5)
        try:
            initial = json.loads(ws.recv())
        finally:
            ws.close()

        assert initial["quiz"]["field_options"] == {"рівень": LEVELS}


def test_config_validation_of_field_options(temp_dir):
    with custom_webquiz_server(config=CONFIG) as (proc, port):
        cookies = get_admin_session(port)
        url = f"http://localhost:{port}/api/admin/config"

        for bad in ("x", ["a"], {"Рівень": "перший"}, {"Рівень": ["перший", 5]}, {"Рівень": ["", "a"]}):
            response = requests.put(url, cookies=cookies, json={"data": {"registration": {"field_options": bad}}})
            assert response.status_code == 400, bad

        saved = requests.put(
            url, cookies=cookies, json={"data": {"registration": {"field_options": {"Рівень": ["альфа", "бета"]}}}}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["config_data"]["registration"]["field_options"] == {"Рівень": ["альфа", "бета"]}
        page = get_page_data(requests.get(f"http://localhost:{port}/").text)
        assert page["page"]["registrationFields"][0]["options"] == ["альфа", "бета"]

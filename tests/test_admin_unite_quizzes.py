"""Tests for the admin unite-quizzes API endpoint."""

import os
import requests
import yaml
from conftest import custom_webquiz_server, get_admin_session


def test_unite_two_quizzes_success(temp_dir):
    """Test uniting two quizzes creates combined quiz."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [
                {"question": "Q1 from quiz1?", "options": ["A", "B"], "correct_answer": 0},
                {"question": "Q2 from quiz1?", "options": ["C", "D"], "correct_answer": 1},
            ],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [
                {"question": "Q1 from quiz2?", "options": ["E", "F"], "correct_answer": 0},
            ],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "united"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["filename"] == "united.yaml"
        assert data["total_questions"] == 3
        assert data["source_quizzes"] == ["quiz1.yaml", "quiz2.yaml"]
        assert "warning" not in data  # No duplicates


def test_unite_three_quizzes_success(temp_dir):
    """Test uniting three quizzes combines all questions."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
        "quiz3.yaml": {
            "title": "Quiz 3",
            "questions": [{"question": "Q3?", "options": ["E", "F"], "correct_answer": 0}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml", "quiz3.yaml"], "new_name": "all_united"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_questions"] == 3
        assert len(data["source_quizzes"]) == 3


def test_unite_takes_config_from_first_quiz(temp_dir):
    """Test that title, show_right_answer, etc. come from first quiz."""
    quizzes = {
        "quiz1.yaml": {
            "title": "First Quiz Title",
            "description": "First quiz description",
            "show_right_answer": False,
            "randomize_questions": True,
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Second Quiz Title",
            "description": "Second quiz description",
            "show_right_answer": True,
            "randomize_questions": False,
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "united_config"},
        )

        assert response.status_code == 200

        # Read the created file and verify config
        quizzes_dir = os.path.join(temp_dir, f"quizzes_{port}")
        united_path = os.path.join(quizzes_dir, "united_config.yaml")
        with open(united_path, "r", encoding="utf-8") as f:
            united_quiz = yaml.safe_load(f)

        assert united_quiz["title"] == "First Quiz Title"
        assert united_quiz["description"] == "First quiz description"
        assert united_quiz["show_right_answer"] is False
        assert united_quiz["randomize_questions"] is True


def test_unite_preserves_question_order(temp_dir):
    """Test questions appear in order: quiz1 questions, then quiz2, etc."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [
                {"question": "First question", "options": ["A", "B"], "correct_answer": 0},
                {"question": "Second question", "options": ["C", "D"], "correct_answer": 1},
            ],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [
                {"question": "Third question", "options": ["E", "F"], "correct_answer": 0},
            ],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "order_test"},
        )

        assert response.status_code == 200

        # Read the created file and verify order
        quizzes_dir = os.path.join(temp_dir, f"quizzes_{port}")
        united_path = os.path.join(quizzes_dir, "order_test.yaml")
        with open(united_path, "r", encoding="utf-8") as f:
            united_quiz = yaml.safe_load(f)

        questions = united_quiz["questions"]
        assert questions[0]["question"] == "First question"
        assert questions[1]["question"] == "Second question"
        assert questions[2]["question"] == "Third question"


def test_unite_requires_at_least_two_quizzes(temp_dir):
    """Test error when trying to unite single quiz."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml"], "new_name": "should_fail"},
        )

        assert response.status_code == 400
        assert "принаймні 2" in response.json()["error"]


def test_unite_empty_quiz_list_error(temp_dir):
    """Test error when quiz_filenames is empty."""
    with custom_webquiz_server() as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": [], "new_name": "empty_test"},
        )

        assert response.status_code == 400
        assert "принаймні 2" in response.json()["error"]


def test_unite_missing_new_name_error(temp_dir):
    """Test error when new_name is not provided."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": ""},
        )

        assert response.status_code == 400
        assert "обов'язкове" in response.json()["error"]


def test_unite_existing_filename_error(temp_dir):
    """Test 409 error when new name already exists."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
        "existing.yaml": {
            "title": "Existing Quiz",
            "questions": [{"question": "Q?", "options": ["X", "Y"], "correct_answer": 0}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "existing"},
        )

        assert response.status_code == 409
        assert "вже існує" in response.json()["error"]


def test_unite_nonexistent_quiz_error(temp_dir):
    """Test 404 error when one of the quizzes doesn't exist."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "nonexistent.yaml"], "new_name": "united"},
        )

        assert response.status_code == 404
        assert "не знайдено" in response.json()["error"]


def test_unite_without_auth(temp_dir):
    """Test 401 error without authentication."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        # No cookies - not authenticated
        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "united"},
        )

        assert response.status_code == 401


def test_unite_warns_on_duplicate_questions(temp_dir):
    """Test warning is included when duplicate questions detected."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [
                {"question": "Same question text", "options": ["A", "B"], "correct_answer": 0},
            ],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [
                {"question": "Same question text", "options": ["C", "D"], "correct_answer": 1},  # Duplicate
                {"question": "Unique question", "options": ["E", "F"], "correct_answer": 0},
            ],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "with_dups"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["total_questions"] == 3  # All included
        assert "warning" in data
        assert "1" in data["warning"]  # 1 duplicate found


def test_unite_same_text_different_file_not_duplicate(temp_dir):
    """Test that same question text with different file is not counted as duplicate."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [
                {"question": "Same question text", "options": ["A", "B"], "correct_answer": 0, "file": "file1.xlsx"},
            ],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [
                {
                    "question": "Same question text",
                    "options": ["C", "D"],
                    "correct_answer": 1,
                    "file": "file2.xlsx",
                },  # Different file
            ],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "no_dups"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["total_questions"] == 2
        # No warning because different files make them unique
        assert "warning" not in data or data.get("warning") is None


def test_unite_with_yaml_extension_in_name(temp_dir):
    """Test that providing .yaml extension in name works correctly."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "united.yaml"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "united.yaml"  # Not united.yaml.yaml


def test_unite_preserves_optional_config_fields(temp_dir):
    """Test description, min_correct, show_answers_on_completion preserved."""
    quizzes = {
        "quiz1.yaml": {
            "title": "Quiz 1",
            "description": "Test description",
            "min_correct": 2,
            "show_answers_on_completion": True,
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Quiz 2",
            "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "quiz2.yaml"], "new_name": "with_options"},
        )

        assert response.status_code == 200

        # Read the created file and verify config
        quizzes_dir = os.path.join(temp_dir, f"quizzes_{port}")
        united_path = os.path.join(quizzes_dir, "with_options.yaml")
        with open(united_path, "r", encoding="utf-8") as f:
            united_quiz = yaml.safe_load(f)

        assert united_quiz["description"] == "Test description"
        assert united_quiz["min_correct"] == 2
        assert united_quiz["show_answers_on_completion"] is True


def test_unite_invalid_quiz_structure_error(temp_dir):
    """Test error when one quiz has invalid structure."""
    # Create a quiz with invalid structure manually
    quizzes = {
        "quiz1.yaml": {
            "title": "Valid Quiz",
            "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        cookies = get_admin_session(port)

        # Create invalid quiz file directly
        quizzes_dir = os.path.join(temp_dir, f"quizzes_{port}")
        invalid_path = os.path.join(quizzes_dir, "invalid.yaml")
        with open(invalid_path, "w", encoding="utf-8") as f:
            yaml.dump({"title": "Invalid Quiz"}, f)  # Missing questions field

        response = requests.post(
            f"http://localhost:{port}/api/admin/unite-quizzes",
            cookies=cookies,
            json={"quiz_filenames": ["quiz1.yaml", "invalid.yaml"], "new_name": "should_fail"},
        )

        assert response.status_code == 400
        assert "неправильну структуру" in response.json()["error"]


# Selenium tests for multi-select UI functionality
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from selenium_helpers import skip_if_selenium_disabled, browser, admin_login, quiz_row, select_quizzes

TWO_QUIZZES = {
    "quiz1.yaml": {"title": "Quiz 1", "questions": [{"question": "Q1?", "options": ["A", "B"], "correct_answer": 0}]},
    "quiz2.yaml": {"title": "Quiz 2", "questions": [{"question": "Q2?", "options": ["C", "D"], "correct_answer": 1}]},
}


def buttons(browser):
    """Visible quiz action buttons by data-testid."""
    return {
        el.get_attribute("data-testid"): el
        for el in browser.find_elements(By.CSS_SELECTOR, "button[data-testid$='-btn']")
        if el.is_displayed()
    }


def switch_to(port, filename):
    cookies = get_admin_session(port)
    requests.post(f"http://localhost:{port}/api/admin/switch-quiz", cookies=cookies, json={"quiz_filename": filename})


@skip_if_selenium_disabled
def test_single_select_shows_standard_buttons(temp_dir, browser):
    """Selecting 1 quiz enables switch/edit/duplicate."""
    with custom_webquiz_server(quizzes=TWO_QUIZZES) as (proc, port):
        admin_login(browser, port)
        select_quizzes(browser, ["quiz1.yaml"])

        visible = buttons(browser)
        assert "unite-btn" not in visible
        for name in ["switch-btn", "edit-btn", "duplicate-btn"]:
            assert visible[name].is_enabled(), name


@skip_if_selenium_disabled
def test_multi_select_shows_unite_button(temp_dir, browser):
    """Selecting 2+ quizzes shows the unite button instead of switch/edit/duplicate."""
    with custom_webquiz_server(quizzes=TWO_QUIZZES) as (proc, port):
        admin_login(browser, port)
        select_quizzes(browser, ["quiz1.yaml", "quiz2.yaml"])

        WebDriverWait(browser, 5).until(lambda d: "unite-btn" in buttons(d))
        visible = buttons(browser)
        for name in ["switch-btn", "edit-btn", "duplicate-btn"]:
            assert name not in visible, name


@skip_if_selenium_disabled
def test_current_quiz_marked_in_list(temp_dir, browser):
    """The current quiz carries a 'поточний' tag in the list."""
    with custom_webquiz_server(quizzes=TWO_QUIZZES) as (proc, port):
        switch_to(port, "quiz1.yaml")
        admin_login(browser, port)

        assert "поточний" in quiz_row(browser, "quiz1.yaml").text
        assert "поточний" not in quiz_row(browser, "quiz2.yaml").text


@skip_if_selenium_disabled
def test_delete_button_disabled_for_current_quiz(temp_dir, browser):
    quizzes = {"quiz1.yaml": TWO_QUIZZES["quiz1.yaml"]}
    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        switch_to(port, "quiz1.yaml")
        admin_login(browser, port)
        select_quizzes(browser, ["quiz1.yaml"])

        assert not buttons(browser)["delete-btn"].is_enabled()

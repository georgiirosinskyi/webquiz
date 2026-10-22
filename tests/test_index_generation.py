"""Tests for the generated quiz page (static/index.html, built from frontend/src/quiz).

The server writes the built page with its data in window.__WEBQUIZ__ on every quiz switch.
"""

import html
import re
import requests
from pathlib import Path
from conftest import custom_webquiz_server, get_admin_session, get_page_data


def read_index(temp_dir, port):
    index_path = Path(temp_dir) / f"static_{port}" / "index.html"
    assert index_path.exists(), "index.html should be created in static directory"
    return index_path.read_text(encoding="utf-8")


def page_questions(html_content):
    return get_page_data(html_content)["page"]["questions"]


def test_questions_data_embedded_correctly(temp_dir):
    """Questions are embedded without correct answers."""
    quiz_data = {
        "test_quiz.yaml": {
            "title": "Data Embedding Test",
            "questions": [
                {"question": "What is 2 + 2?", "options": ["3", "4", "5", "6"], "correct_answer": 1},
                {
                    "question": "What color is the sky?",
                    "options": ["Red", "Blue", "Green"],
                    "correct_answer": 1,
                    "image": "/imgs/sky.png",
                },
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        q1, q2 = page_questions(read_index(temp_dir, port))

        assert q1["id"] == 1
        assert q1["question"] == "What is 2 + 2?"
        assert q1["options"] == ["3", "4", "5", "6"]
        assert "correct_answer" not in q1, "Correct answer should NOT be included in client data"
        assert "image" not in q1

        assert q2["id"] == 2
        assert q2["image"] == "/imgs/sky.png"
        assert "correct_answer" not in q2


def test_quiz_title_embedded(temp_dir):
    quiz_data = {
        "title_test.yaml": {
            "title": "Amazing Quiz Title!",
            "questions": [{"question": "Test question?", "options": ["A", "B"], "correct_answer": 0}],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        html_content = read_index(temp_dir, port)
        assert "<title>Amazing Quiz Title!</title>" in html_content
        assert get_page_data(html_content)["page"]["title"] == "Amazing Quiz Title!"


def test_webquiz_version_embedded(temp_dir):
    with custom_webquiz_server() as (proc, port):
        version = get_page_data(read_index(temp_dir, port))["version"]
        assert re.fullmatch(r"[\d\w\.\-]+", version), version


def test_correct_answers_excluded_from_client_data(temp_dir):
    """Security test: correct answers are never leaked to the client."""
    quiz_data = {
        "security_test.yaml": {
            "title": "Security Test Quiz",
            "questions": [
                {"question": "Secret answer test?", "options": ["Wrong", "Correct!", "Also wrong"], "correct_answer": 1},
                {"question": "Another secret?", "options": ["A", "B", "C", "D"], "correct_answer": 3},
                {"question": "Text?", "checker": "assert user_answer == '42'", "correct_value": "42"},
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        html_content = read_index(temp_dir, port)
        for question in page_questions(html_content):
            assert "correct_answer" not in question
            assert "correct_value" not in question
            assert "checker" not in question
        assert '"correct_answer"' not in html_content
        assert "user_answer == " not in html_content


def test_optional_fields_included(temp_dir):
    quiz_data = {
        "optional_fields.yaml": {
            "title": "Optional Fields Test",
            "questions": [
                {"question": "Text only question?", "options": ["A", "B"], "correct_answer": 0},
                {"question": "Question with image?", "options": ["Yes", "No"], "correct_answer": 0, "image": "/imgs/test.jpg"},
                {"options": ["Option 1", "Option 2"], "correct_answer": 1, "image": "/imgs/image_only.png"},
                {"image": "/imgs/question1.png", "options": ["/imgs/a.png", "/imgs/b.png", "/imgs/c.png"], "correct_answer": 1},
                {"question": "With file", "options": ["A", "B"], "correct_answer": 0, "file": "data.xlsx", "points": 2},
            ],
        }
    }

    with custom_webquiz_server(quizzes=quiz_data) as (proc, port):
        q1, q2, q3, q4, q5 = page_questions(read_index(temp_dir, port))

        assert q1["question"] == "Text only question?" and "image" not in q1
        assert q2["image"] == "/imgs/test.jpg"
        assert "question" not in q3 and q3["image"] == "/imgs/image_only.png"
        assert "question" not in q4 and q4["options"] == ["/imgs/a.png", "/imgs/b.png", "/imgs/c.png"]
        assert q5["file"] == "/attach/data.xlsx", "The server prepends /attach/ to files"
        assert q5["points"] == 2


def test_page_data_and_assets(temp_dir):
    """The data marker is replaced and the assets are linked relative to the page (reverse proxy prefix)."""
    quiz_data = {
        "placeholder_test.yaml": {
            "title": "Placeholder Test Quiz",
            "questions": [{"question": "Test?", "options": ["Yes", "No"], "correct_answer": 0}],
        }
    }

    with custom_webquiz_server(config={"registration": {"fields": ["Grade"]}}, quizzes=quiz_data) as (proc, port):
        html_content = read_index(temp_dir, port)
        assert "<!--WEBQUIZ_DATA-->" not in html_content
        assert '="/ui/' not in html_content, "Assets must be linked relative to the page"
        assets = re.findall(r'(?:src|href)="(ui/assets/[^"]+)"', html_content)
        assert assets
        for asset in assets:
            assert requests.get(f"http://localhost:{port}/{asset}").status_code == 200, asset

        data = get_page_data(html_content)
        page = data["page"]
        assert page["title"] == "Placeholder Test Quiz"
        assert len(page["quizVersion"]) == 16
        assert page["showRightAnswer"] is True
        assert page["registrationFields"] == [{"label": "Grade", "name": "grade"}]
        assert page["translations"]["register_button"] == "Зареєструватися"


def test_quiz_page_loads_only_react(temp_dir):
    """Weak student devices: the quiz page does not load the antd chunk of the admin pages."""
    with custom_webquiz_server() as (proc, port):
        html_content = read_index(temp_dir, port)
        assert "vendor-" not in html_content
        assert re.search(r'ui/assets/react-[^"]+\.js', html_content)


def test_index_html_file_created_in_static_dir(temp_dir):
    with custom_webquiz_server() as (proc, port):
        static_path = Path(temp_dir) / f"static_{port}"
        index_path = static_path / "index.html"
        assert static_path.is_dir(), f"Static directory should be created at {static_path}"
        assert index_path.is_file(), "index.html should be created"
        assert index_path.stat().st_size > 0, "index.html should not be empty"


def test_index_html_content_is_valid_html(temp_dir):
    with custom_webquiz_server() as (proc, port):
        html_content = read_index(temp_dir, port).lower()
        assert html_content.startswith("<!doctype html>")
        assert "<head>" in html_content and "</head>" in html_content
        assert "<body>" in html_content and "</body>" in html_content
        assert '<meta charset="utf-8"' in html_content
        assert '<meta name="viewport"' in html_content
        assert '<div id="root"></div>' in html_content


def test_regeneration_on_quiz_switch(temp_dir):
    quizzes = {
        "default.yaml": {
            "title": "First Quiz",
            "questions": [{"question": "Question 1?", "options": ["A", "B"], "correct_answer": 0}],
        },
        "quiz2.yaml": {
            "title": "Second Quiz",
            "questions": [{"question": "Question 2?", "options": ["X", "Y", "Z"], "correct_answer": 1}],
        },
    }

    with custom_webquiz_server(quizzes=quizzes) as (proc, port):
        initial = read_index(temp_dir, port)
        assert "First Quiz" in initial and "Question 1?" in initial

        cookies = get_admin_session(port)
        response = requests.post(
            f"http://localhost:{port}/api/admin/switch-quiz", cookies=cookies, json={"quiz_filename": "quiz2.yaml"}
        )
        assert response.status_code == 200

        updated = read_index(temp_dir, port)
        assert "Second Quiz" in updated and "Question 2?" in updated
        assert "First Quiz" not in updated and "Question 1?" not in updated
        questions = page_questions(updated)
        assert len(questions) == 1
        assert questions[0]["options"] == ["X", "Y", "Z"]


def test_empty_quiz_handling(temp_dir):
    with custom_webquiz_server(quizzes={"empty.yaml": {"title": "Empty Quiz", "questions": []}}) as (proc, port):
        html_content = read_index(temp_dir, port)
        assert "<title>Empty Quiz</title>" in html_content
        assert page_questions(html_content) == []


def test_special_characters_in_quiz_data(temp_dir):
    title = 'Quiz "with" special & characters'
    special_quiz = {
        "special_chars.yaml": {
            "title": title,
            "questions": [
                {
                    "question": 'What about "quotes" & <tags>? </script><script>alert(1)</script>',
                    "options": ['Option with "quotes"', "Option with & ampersand", "Option with <html> tags", "'single'"],
                    "correct_answer": 0,
                }
            ],
        }
    }

    with custom_webquiz_server(quizzes=special_quiz) as (proc, port):
        html_content = read_index(temp_dir, port)
        assert f"<title>{html.escape(title)}</title>" in html_content
        assert "</script><script>alert(1)" not in html_content, "Quiz data must not close the data script"

        data = get_page_data(html_content)["page"]
        assert data["title"] == title
        q = data["questions"][0]
        assert q["question"] == 'What about "quotes" & <tags>? </script><script>alert(1)</script>'
        assert "Option with <html> tags" in q["options"]


def test_question_text_copy_prevention(temp_dir):
    """The question text cannot be selected or copied; the text answer input stays selectable."""
    with custom_webquiz_server() as (proc, port):
        html_content = read_index(temp_dir, port)
        css = "".join(
            requests.get(f"http://localhost:{port}/{asset}").text
            for asset in re.findall(r'href="(ui/assets/[^"]+\.css)"', html_content)
        )
        js = requests.get(f"http://localhost:{port}/" + re.search(r'src="(ui/assets/quiz-[^"]+\.js)"', html_content).group(1)).text

        assert re.search(r"\.current-question\{[^}]*user-select:none", css.replace(" ", "")), "Question text not selectable"
        assert re.search(r"\.current-question \.text-answer-input\{[^}]*user-select:text", css.replace(": ", ":")), css[:200]
        assert "onCopy" in js, "The question container blocks the copy event"


def test_very_long_quiz_titles(temp_dir):
    long_title = "This is a very " * 50 + "long quiz title!"
    quiz = {"long_title.yaml": {"title": long_title, "questions": [{"question": "Q?", "options": ["A", "B"], "correct_answer": 0}]}}

    with custom_webquiz_server(quizzes=quiz) as (proc, port):
        html_content = read_index(temp_dir, port)
        assert f"<title>{long_title}</title>" in html_content
        assert get_page_data(html_content)["page"]["title"] == long_title

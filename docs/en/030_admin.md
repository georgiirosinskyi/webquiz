## WebQuiz Administrative Interface

The **WebQuiz** administrative interface allows you to manage quizzes, view results, approve user requests, and work with files directly through the browser.
Access to the panel opens automatically if you connect from a local address (`127.0.0.1` or `localhost`), or using a **Master Key** if connecting from another device on the network.

---

### Navigation

All admin pages are one application with a menu at the top:

- **Overview** — the main screen: the current quiz and all participants, updated live. The badge shows how many participants wait for approval.
- **Quizzes** — quiz files, the quiz editor, uniting quizzes and downloading quiz sets.
- **Archive** — every quiz run with its CSV files and log. The badge for incoming file requests is on **Quizzes**.
- **Settings** — the server configuration (`webquiz.yaml`). Shown only when the server was started with a config file.
- **Access** — URLs for other devices and the SSH tunnel. A green dot shows that the tunnel is connected.

Every section has its own address (`/admin/quizzes`, `/admin/archive`, `/admin/settings`, `/admin/access`), so you can bookmark it; the old `/files/` and `/admin/files` addresses open the Archive section. The browser Back button moves between sections. The version and the documentation link are at the bottom of every section.

---

### Overview

![WebQuiz Admin Panel](../imgs/admin_advanced.png)

The **current quiz** card at the top shows the quiz title (the file name only when the quiz has no title; the file is selected in the drop-down list), its settings (questions, total points, time limit, shuffling, skipping, approval) and counters: registered, waiting, in progress, finished and the average score of finished participants.

- The drop-down list switches to another quiz and **Restart** starts the current quiz again. Both ask for confirmation, because they clear all participants.
- **Edit** opens the current quiz in the editor.
- **Open answers for all** is shown for quizzes with `show_answers_on_completion: true` (see **Answer Management** below).

The table below lists every participant and changes as they answer:

- **Status** — *Waiting for approval*, *In progress*, *Finished* or *Time is up*.
- **Progress** — a bar (green — correct, red — incorrect, yellow — skipped, grey — not answered yet) with the counts "✓ correct ✗ incorrect ⏭ skipped · answers/questions". Expand the row to see the answer to each question.
- **Points**, **Grade** (when the test is finished) and **Time** (with the remaining time when the quiz has a time limit).
- Registration fields (for example, Class) get their own columns.

When approval is enabled (`registration.approve: true`, see [Configuration](040_config.md)), participants waiting for approval have a yellow background and an **Approve** button; **Approve all** approves everybody at once. The quiz timer starts only after approval.
The table is in registration order, and **#** is the participant's fixed number by registration: it does not change when the participant finishes or the table is sorted. Click a column header to sort the table by it (click again for the reverse order). **Progress** sorts by the number of answers given, and with the same number by the number of correct ones; **Progress**, **Points** and **Grade** show the highest values first.

Click a row to see every question of the participant: the answer they gave (green — correct, red — incorrect, "—" — no answer), the correct answer, the result and the time. Filter the list with **All / Waiting / In progress / Finished** and the search field (it searches names and registration fields).

- **Answer Management**
  This section appears only for quizzes with `show_answers_on_completion: true` enabled (see "Quiz File Format" section for details about this option).

  Allows the administrator to force open correct answers for all students without waiting for everyone to complete the test.

  **When this is useful:**
  - Most students have completed the test, but 2-3 students are lagging
  - You don't want to wait for stragglers and are ready to show answers to everyone

  **How it works:**
  1. Click the **"Show Answers for All"** button
  2. Confirm the action in the dialog box
  3. All students (including those who haven't finished yet) will see the correct answers after completing the test
  4. New students who register later will also see the answers

  > ⚠️ **Important:** This is a one-way action — it can only be undone by restarting the quiz or switching to another test.

---

### Quizzes

- **Available Quiz Files**
  The **Quizzes** card shows a tree of all quizzes in the `quizzes` folder: quizzes from subfolders are grouped into folders (folders start closed; click a folder or its `+`/`−` to open or close it, the number in brackets is how many quizzes it holds).
  Each quiz shows its file, title, number of questions, total points, time limit and the settings that differ from the defaults: 🔀 Shuffle, ⏭ Can skip, 🙈 Right answers hidden (`show_right_answer: false`), 👁 Answers after everyone (`show_answers_on_completion: true`), 📋 No final list (`show_final_list: false`). On a phone the title is shown under the file name.
  The current active quiz is marked with a green **current** tag; its name is also shown above the table.

  Click a row to select a quiz, tick the checkboxes (or **Ctrl+click** / **Cmd+click** on macOS) to select several, and double-click a row to open it in the editor.
  With one quiz selected, the buttons **Switch** (**Restart current** for the active quiz), **Edit**, **Duplicate** and **Delete** are available. **Download** saves the YAML files of the selected quizzes to your computer. **Edit YAML** opens the quiz text for direct editing: **Validate YAML** shows the errors, **Save** writes the file (a `.backup` copy is made first, the active quiz is reloaded). With several quizzes selected, **Unite quizzes** appears instead of Switch/Edit/Duplicate. The active quiz cannot be deleted.

  You can switch between quizzes or create new ones.

  Switching or restarting a quiz clears all participants. Quiz pages of the old quiz that students still have open reload automatically within a few seconds, so students see the new quiz right away; the server does not accept answers from a page of the old quiz.

- **"New quiz" Button**
  Opens the interface for creating a new quiz in visual mode.
  The new file will be added to the `quizzes` directory.

- **"Delete" Button**
  Deletes the selected quizzes from the file system after a confirmation.

- **Available Quizzes for Download**
  This section appears only if the `quizzes` section is configured in `webquiz.yaml` (see [Configuration](040_config.md) for details).
  It shows quizzes available for download from external sources (e.g., GitHub repositories).
  The **"Download"** button automatically downloads the archive and extracts it to the `quizzes` folder.

---

### Access

- **URL for Access from Other Devices**
  The section shows links that other participants can use to connect to the quiz.
  This includes the local network address (e.g., `http://192.168.1.100:8080/`).
  When an SSH tunnel is connected, an external URL is also shown with a green background.

- **SSH Tunnel**
  This section appears only if the `tunnel` section is configured in `webquiz.yaml` (see [Configuration](040_config.md) for details).
  It allows you to expose your local quiz server to the internet via SSH reverse tunnel.
  - **Server** — displays the tunnel server hostname
  - **Public key** — your SSH public key that needs to be registered on the tunnel server. Use the **Copy** button to copy it to the clipboard.
  - **Connect/Disconnect** — click to establish or terminate the tunnel connection

  When connected, a public URL appears in the "URL for Access from Other Devices" section with a green background, allowing participants outside your local network to join the quiz.

---

### Archive

The **Archive** section in the menu. Every quiz switch or restart starts a new **archive record** — its own folder in the `archive` folder (see [Configuration](040_config.md)), for example `2026-10-15-143005-math`. It holds all data of that run:
- `answers.csv` — the users' answers;
- `users.csv` — users with registration fields, grade and time;
- `answers_with_users.csv` — only with `extra_answers_with_users_csv: true`;
- `server.log` — the server log of this record (the first record after the server starts also has the startup information).

The archive table shows for every record: the start **Date**, the **Quiz** (title and file; the running record has a **current** tag), the number of **questions**, the number of **users**, the share of **correct** answers among the given ones and the average **time per question**. The numbers of the current record update live.

Click a record to see its files. They are shown as cards, three in a row (one on a phone), with readable names: **Results** (first), **Detailed answers**, **Answers with user data**, **Server log** (last); below the name are the file name and size. **View** opens a CSV file as a table (centered headers; the name, registration fields, questions and answers left-aligned, the rest centered) and the log as text. CSV files download with the **CSV** or **XLSX** button (an Excel workbook with a bold header, cell borders and centered cells except the name, registration fields and the question and answer texts), the log with **Download**. **Download all files (zip)** above the cards downloads every file of the record as one archive.

The table view window is as wide as the table, up to 90% of the screen. Drag it by its title, and drag its bottom right corner to resize it.

Records without users (for example after saving the settings, which restarts the quiz) are hidden; the **Show records without users** switch shows them too.

Old files from the `data/` and `logs/` folders of earlier versions are not moved and not shown in the archive; they stay on disk as they were.

- **Incoming File Requests**
  This panel appears in the **Quizzes** and **Archive** sections when another WebQuiz server on the same tunnel server wants to send quizzes or archive records (see [Sending to Another Server](#sending-to-another-server)). The badge on the **Quizzes** menu item shows the number of requests.
  It shows the sender's name and every file with its case:
  - **New file** — there is no file (record) with this name. Choose **Save**, **Rename** or **Skip**.
  - **Same file already exists** — choose **Skip** (default), **Replace** or **Rename**.
  - **A different file with this name exists** — choose **Rename** (default), **Replace** or **Skip**.
  - **File is used by the server** (the current archive record, the active quiz) — choose **Rename** or **Skip**. It cannot be replaced.

  For **Rename** a free name is suggested; you can change it. Then click:
  - **Accept** — download the files as chosen. If a choice is not possible, an error is shown and nothing is downloaded, so you can choose again.
  - **Reject** — refuse the files. The sender sees that the request was rejected.

#### Sending to Another Server

You can send quizzes and archive records to another WebQuiz server, for example from one classroom computer to another. Both servers must:
- be connected to **the same tunnel server** with the keys of **the same SSH user**;
- have a fixed and different `socket_name` (see [Configuration](040_config.md));
- have the SSH tunnel connected in the admin panel.

The **Send files to another server** panel appears in the **Quizzes** and **Archive** sections only while the tunnel is connected. It shows the name of this server.

1. Select quizzes in the **Quizzes** section or records in the **Archive** section.
2. Enter the other server's name (its `socket_name`) and click **Send**.
3. The other server's admin panel shows the request. After **Accept** the files are downloaded.
4. Below the panel you see the state of your requests: waiting, accepted, rejected or expired.

Notes:
- A request expires if nobody answers it within 30 minutes. Both servers must stay connected until then.
- Images and attachments used by a quiz (from `quizzes/imgs/` and `quizzes/attach/`) are sent with it automatically. You do not need to select them.
- An archive record is sent as a whole folder (as `<record>.zip`) and becomes a folder in the other server's archive again. A renamed record gets the sender's name at the end (`2026-10-15-143005-math-room-12`).
- If an image or attachment is saved under a new name, the received quiz is changed to use it, so the quiz shows the right image.

---

### Settings

![Config Tab](../imgs/file_manager_config.png)

The **Settings** section provides two ways to edit the server configuration:

**Form view** (default) — a structured form for the language, the quiz page background (color or image, with a preview; see [Configuration](040_config.md)) and registration settings:
- **Require admin approval** — checkbox to enable/disable approval workflow
- **Username label** — customize the label for the username field
- **Additional registration fields** — add/remove extra fields (e.g., Grade, School)

**YAML view** — a text editor for direct YAML editing with full access to all configuration options.

Use the **Form** / **YAML** toggle to switch between views. If you have unsaved changes, you will be asked to confirm before switching. After saving, both views are automatically updated.

- Click **Save Configuration** to save changes
- Changes are validated before saving, and a backup is created automatically

---

### Quiz Editor

![Quiz Editor in Wizard Mode](../imgs/edit_quiz.png)

The Quiz Editor allows you to create or modify questions in the selected quiz.
The editor uses a visual wizard interface for easy question management.

#### Quiz Settings

- **Quiz Filename**
  The filename for the quiz (without the `.yaml` extension). To put the quiz into a folder inside `quizzes/`, include the path, for example `grade5/math`; missing folders are created automatically. This also works when renaming an existing quiz and when uniting quizzes.

- **Quiz Name (optional)**
  A human-readable title for the quiz. If not specified, the filename is used.

- **Show Correct Answers**
  If enabled, participants see the correct answers during the quiz and in the final summary table.

- **Randomize Question Order**
  If enabled, questions are shuffled for each participant. Each student sees questions in a different random order.

- **Show the list of questions at the end**, **Allow skipping questions**, **Time limit (seconds)**
  The `show_final_list`, `allow_skip_questions` and `time_limit` options (see [Quiz File Format](050_quiz_format.md)). An empty time limit or 0 means no limit.

Options the editor does not show (for example `marks` and `default_mark`) and unknown question fields are kept when the quiz is saved from the editor.

#### Question Editor

For each question, you can configure:

- **Question Text** — the question to ask (required if no image is provided)

- **Question Image** — path to an image file (e.g., `/imgs/diagram.png`). Click the folder icon to browse available images. Images are stored in the `quizzes/imgs/` folder; when there are none, the picker shows the full path of that folder on this computer.

- **File for Download** — attach a file that participants can download when answering the question (e.g., `data.xlsx`). Click the paperclip icon to browse available files. Files are stored in the `quizzes/attach/` folder.

- **Question Type** — three types are available:
  - **Single correct answer** — participants select one option from a list
  - **Multiple correct answers** — participants can select multiple options
  - **Text answer** — participants type their answer in a text field (validated using checker code). *This feature is currently in beta testing.*

- **Answer Options** — for single/multiple choice questions, add answer options (a new question starts with 4 empty ones). Each option can be text or an image path. Mark the correct answer(s) with the radio button or checkbox.

- **Points per Question** — the number of points awarded for a correct answer (default: 1). Questions with more than 1 point show a trophy indicator.

- **Stick to Previous Question** — when randomization is enabled, this keeps the question adjacent to the previous one. Useful for grouping related questions together.

Questions can be reordered by dragging the handle on the left or with the arrow buttons, and collapsed/expanded by clicking the question header.

Before saving, the editor checks every question: it needs text or an image, filled answer options, at least one correct answer for multiple choice, and points greater than 0 with at most 2 decimal places. Problems are listed under the questions with the question number, and those questions are expanded.

#### Saving

- **Save Quiz** — save the quiz and close the editor
- **Save and Continue** — save the quiz and continue editing
- **Cancel** — discard changes and close the editor

---

### Quick Access

The menu at the top of the admin app leads to every section. The participant page is at the root address of the server (`/`).

---

### Package Version Check

The admin panel automatically checks if the WebQuiz package has been updated while the server is running.
If a new version is detected (for example, after updating via `pip install --upgrade webquiz`), a notification will appear at the bottom of the panel:

- **"New version installed (vX.Y)" + "Restart Required"** — means a new version of the package has been installed, but the server is still running the old version.

To apply the update, you need to restart the WebQuiz server.

---

This panel provides a complete **WebQuiz** management cycle — from creating quizzes and approving users to monitoring results and downloading reports.
It is designed for local operation, so all information remains on your network without being transmitted to the internet.

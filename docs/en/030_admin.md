## WebQuiz Administrative Interface

The **WebQuiz** administrative interface allows you to manage quizzes, view results, approve user requests, and work with files directly through the browser.
Access to the panel opens automatically if you connect from a local address (`127.0.0.1` or `localhost`), or using a **Master Key** if connecting from another device on the network.

---

### Navigation

All admin pages are one application with a menu at the top:

- **Overview** — the main screen: the current quiz and all participants, updated live. The badge shows how many participants wait for approval.
- **Quizzes** — quiz files, the quiz editor, uniting quizzes and downloading quiz sets.
- **Files** — CSV results, logs, quiz files and sending files to another server. The badge shows incoming file transfer requests.
- **Settings** — the server configuration (`webquiz.yaml`). Shown only when the server was started with a config file.
- **Access** — URLs for other devices and the SSH tunnel. A green dot shows that the tunnel is connected.

Every section has its own address (`/admin/quizzes`, `/admin/files`, `/admin/settings`, `/admin/access`), so you can bookmark it; the old `/files/` address opens the Files section. The browser Back button moves between sections. The version and the documentation link are at the bottom of every section.

---

### Overview

![WebQuiz Admin Panel](../imgs/admin_advanced.png)

The **current quiz** card at the top shows the quiz title and file, its settings (questions, total points, time limit, shuffling, skipping, approval) and counters: registered, waiting, in progress, finished and the average score of finished participants.

- The drop-down list switches to another quiz and **Restart** starts the current quiz again. Both ask for confirmation, because they clear all participants.
- **Edit** opens the current quiz in the editor.
- **For the projector** opens Live Stats in a new tab.
- **Open answers for all** is shown for quizzes with `show_answers_on_completion: true` (see **Answer Management** below).

The table below lists every participant and changes as they answer:

- **Status** — *Waiting for approval*, *In progress*, *Finished* or *Time is up*.
- **Progress** — a dot per question in the order the participant sees the questions (blue — answering, green — correct, red — incorrect, yellow — skipped, grey — not opened yet) and the number of answers given.
- **Points**, **Grade** (when the test is finished) and **Time** (with the remaining time when the quiz has a time limit).
- Registration fields (for example, Class) get their own columns.

When approval is enabled (`registration.approve: true`, see [Configuration](040_config.md)), participants waiting for approval come first, with a yellow background and an **Approve** button; **Approve all** approves everybody at once. The quiz timer starts only after approval.
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
  With one quiz selected, the buttons **Switch** (**Restart current** for the active quiz), **Edit**, **Duplicate** and **Delete** are available. With several quizzes selected, **Unite quizzes** appears instead of Switch/Edit/Duplicate. The active quiz cannot be deleted.

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

### Files

![WebQuiz File Manager](../imgs/file_manager.png)

The **Files** section of the menu.
It allows you to quickly view, download, edit, and diagnose files created by the server.

- **File Transfer Requests**
  This panel appears when another WebQuiz server on the same tunnel server wants to send files (see [Sending Files to Another Server](#sending-files-to-another-server)).
  It shows the name of the sending server and every file with its case:
  - **New file** — there is no file with this name. Choose **Save**, **Rename** or **Skip**.
  - **The same file already exists** — choose **Skip** (default), **Replace** or **Rename**.
  - **A different file with this name exists** — choose **Rename** (default), **Replace** or **Skip**.
  - **The file is used by the server now** (current log, current CSV files, active quiz) — choose **Rename** or **Skip**. It cannot be replaced.

  For **Rename**, a free name is suggested; you can change it. Then click:
  - **Accept** — download the files as chosen. They appear in the File Manager. If a choice is not possible, an error is shown and nothing is downloaded, so you can choose again.
  - **Reject** — refuse the files. The sender sees that the request was rejected.

At the top of the page, there's a **search field** to filter files by name, and a **Refresh** button to reload the file list.

#### Main Tabs

- **CSV files** — list of quiz result files.
  Each item shows the file name, size, and last modification date.
  Three buttons are available for each file:
  - **Text** — view the raw CSV content in the browser
  - **Table** — view the data in a formatted table (see below)
  - **Download** — save the file locally

- **Logs** — server launch logs.
  Useful for finding technical errors or checking how the server performed in previous sessions.

- **Quizzes** — list of quiz YAML files from the `quizzes` folder.
  You can view and edit quiz files directly. When editing, a **Validate** button checks the YAML syntax before saving.

#### Sending Files to Another Server

You can send quiz, log and CSV files to another WebQuiz server, for example from one classroom computer to another. Both servers must:
- be connected to the **same tunnel server** with keys of the **same SSH user**;
- have a fixed, different `socket_name` (see [Configuration](040_config.md));
- have the SSH tunnel connected on the admin panel.

The **Send files to another server** panel appears only while the tunnel is connected. It shows the name of this server, and a checkbox appears next to every quiz, log and CSV file.

1. Tick the files on any tab.
2. Type the name of the other server (its `socket_name`) and click **Send**.
3. The other server's admin panel shows the request. After **Accept**, the files are downloaded.
4. Below the panel you see the status of your requests: waiting, accepted, rejected or expired.

Notes:
- A request expires if it is not answered in 30 minutes. Keep both servers connected until then.
- Images and attached files used by a sent quiz (from `quizzes/imgs/` and `quizzes/attach/`) are sent with it automatically. You do not need to select them.
- On the other server, the admin chooses for every file: save, replace, rename or skip (see **File Transfer Requests** above). Logs and CSV files are saved with the sender name (`room-12_0001.log`).
- If an image or attachment is saved under a new name, the received quiz is changed to use it, so the quiz shows the right image.

#### Table View

![CSV Table View](../imgs/file_manager_table.png)

When you click the **Table** button for a CSV file, a modal window opens displaying the data in a formatted table. The table shows columns such as:
- **user_id** — the participant's ID
- **question** — the question text
- **selected_answer** — the answer chosen by the participant
- **correct_answer** — the correct answer
- **is_correct** — whether the answer was correct (True/False)
- **time_taken** — time spent on the question in seconds

This view makes it easy to analyze quiz results without downloading the file.

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

- **Question Image** — path to an image file (e.g., `/imgs/diagram.png`). Click the folder icon to browse available images. Images are stored in the `quizzes/imgs/` folder.

- **File for Download** — attach a file that participants can download when answering the question (e.g., `data.xlsx`). Click the paperclip icon to browse available files. Files are stored in the `quizzes/attach/` folder.

- **Question Type** — three types are available:
  - **Single correct answer** — participants select one option from a list
  - **Multiple correct answers** — participants can select multiple options
  - **Text answer** — participants type their answer in a text field (validated using checker code). *This feature is currently in beta testing.*

- **Answer Options** — for single/multiple choice questions, add answer options. Each option can be text or an image path. Mark the correct answer(s) with the radio button or checkbox.

- **Points per Question** — the number of points awarded for a correct answer (default: 1). Questions with more than 1 point show a trophy indicator.

- **Stick to Previous Question** — when randomization is enabled, this keeps the question adjacent to the previous one. Useful for grouping related questions together.

Questions can be reordered by dragging the handle on the left or with the arrow buttons, and collapsed/expanded by clicking the question header.

Before saving, the editor checks every question: it needs text or an image, filled answer options, at least one correct answer for multiple choice, and points greater than 0 with at most 2 decimal places. Problems are listed under the questions with the question number, and those questions are expanded.

#### Saving

- **Save Quiz** — save the quiz and close the editor
- **Save and Continue** — save the quiz and continue editing
- **Cancel** — discard changes and close the editor

---

### Live Statistics

![Live Statistics](../imgs/livestats.png)

The Live Statistics page provides real-time monitoring of quiz progress for all participants. Open it with **For the projector** on the Overview.

The page title shows the name of the current quiz.

#### Filter

The switch at the top right shows:
- **All** — all registered participants
- **In Progress** — participants currently taking the quiz
- **Completed** — participants who have finished the quiz (newest first)

Each option shows the count of participants in that category.

#### Statistics Grid

The main area displays a grid with:
- **User column** (stays visible while scrolling sideways) — participant name, an icon for in progress / completed, and the earned points out of the total
- **Question columns** — question text (an image for image-only questions), the number of correct answers out of the answers given, 📎 for an attached file and 🏆 for questions worth other than 1 point

#### Color Coding

Each cell shows the participant's answer status (the legend is under the grid):
- **Blue** — currently answering this question
- **Green** — correct answer
- **Red** — incorrect answer
- **Yellow** — skipped
- **Grey** — not reached yet

Each answered cell also displays the time taken to answer that question.

If the connection to the server drops, the page reconnects by itself and shows a notice; after several failed attempts a **Reconnect** button appears.

This view allows you to monitor quiz progress in real-time and identify participants who may be struggling or need assistance.

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

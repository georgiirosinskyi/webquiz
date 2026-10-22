import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getServerData } from "../shared/serverData";
import { createFetchWithRetry, shouldReloadForNewQuiz } from "./connection";
import {
  answeredCount,
  applyQuestionOrder,
  applyServerState,
  deadlineFrom,
  formatPoints,
  formatTimer,
  generateRequestToken,
  initialQuestions,
  isImagePath,
  nextQuestionIndex,
  pickQuestionIndex,
  pointsWord,
  relativePath,
  remainingSeconds,
  skipButtonMode,
  skipNeedsRequest,
  timerLevel,
  type Answer,
  type QuizPageData,
  type QuizQuestion,
} from "./logic";
import { ClientResultsView, FinalResultsView, type ClientResult, type FinalResults } from "./Results";

type Phase = "loading" | "registration" | "waiting" | "test" | "results";
// answering: the student picks an answer; feedback: the result is shown with Continue;
// advancing: the page moves on by itself (hidden feedback, skip)
type Mode = "answering" | "feedback" | "advancing";

interface Feedback {
  isCorrect: boolean;
  correctAnswer?: number | number[] | null;
  checkerError?: string;
  correctValue?: string;
}

interface VerifyResponse {
  valid?: boolean;
  user_id: string;
  username: string;
  approved?: boolean;
  requires_approval?: boolean;
  question_order?: number[];
  test_completed?: boolean;
  final_results?: FinalResults;
  next_question_index?: number;
  time_limit?: number;
  remaining_seconds?: number;
  allow_skip_questions?: boolean;
  answered_questions?: Record<string, Answer>;
  skipped_questions?: number[];
  message?: string;
  error?: string;
}

const QUIZ_VERSION_POLL_MS = 5000;
const APPROVAL_POLL_MS = 1000;
const ERROR_HIDE_MS = 5000;
const REGISTRATION_STORAGE_KEY = "webquiz_registration_data";

function loadRegistrationData(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REGISTRATION_STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function saveRegistrationData(data: Record<string, string>) {
  try {
    localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Not remembered for the next time; fine
  }
}

function setCookie(name: string, value: string, days = 30) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Quiz text may contain HTML written by the quiz author
const html = (value: string) => ({ __html: value });

// Error text that hides itself after a few seconds
function useAutoHideError(): [string, (message: string) => void, () => void] {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(""), ERROR_HIDE_MS);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setMessage("");
  }, []);
  return [message, show, hide];
}

function ErrorMessage({ id, message }: { id: string; message: string }) {
  return (
    <div id={id} className={`error-message${message ? "" : " hidden"}`}>
      {message}
    </div>
  );
}

export function QuizApp({ page }: { page: QuizPageData }) {
  const t = page.translations;
  const { version } = getServerData();

  const [phase, setPhase] = useState<Phase>("loading");
  const [username, setUsername] = useState<string | null>(null);
  const [questions, setQuestionsState] = useState<QuizQuestion[]>(() => initialQuestions(page.questions));
  const [current, setCurrentState] = useState(0);
  const [mode, setMode] = useState<Mode>("answering");
  const [selected, setSelected] = useState<number[]>([]);
  const [textAnswer, setTextAnswer] = useState("");
  const [answerLocked, setAnswerLocked] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [continueBusy, setContinueBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [allowSkip, setAllowSkip] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [results, setResults] = useState<{ final?: FinalResults; client?: ClientResult[] } | null>(null);
  const [waitingRequests, setWaitingRequests] = useState(0);
  const [quizChangedText, setQuizChangedText] = useState("");
  const [registrationError, showRegistrationError, hideRegistrationError] = useAutoHideError();
  const [waitingError, showWaitingError, hideWaitingError] = useAutoHideError();
  const [testError, showTestError, hideTestError] = useAutoHideError();

  // Mutable copies for the async flows below, which outlive a render
  const questionsRef = useRef(questions);
  const currentRef = useRef(current);
  const userIdRef = useRef<string | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const countdownRef = useRef<number | undefined>(undefined);
  const approvalTimerRef = useRef<number | undefined>(undefined);
  const checkingApprovalRef = useRef(false);
  const finishingRef = useRef(false);
  const questionStartRef = useRef<Promise<unknown>>(Promise.resolve());
  const clientResultsRef = useRef<ClientResult[]>([]);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const reloadingRef = useRef(false);

  const setQuestions = (next: QuizQuestion[]) => {
    questionsRef.current = next;
    setQuestionsState(next);
  };
  const setCurrent = (index: number) => {
    currentRef.current = index;
    setCurrentState(index);
  };

  const reloadForNewQuiz = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    if (shouldReloadForNewQuiz(page.quizVersion)) {
      setQuizChangedText(t.quiz_changed);
      location.reload();
    } else {
      setQuizChangedText(t.quiz_changed_reload);
    }
  }, [page.quizVersion, t]);

  const fetchWithRetry = useMemo(
    () =>
      createFetchWithRetry({
        quizVersion: page.quizVersion,
        onWaitingChange: (change) => setWaitingRequests((count) => count + change),
        onQuizChanged: reloadForNewQuiz,
      }),
    [page.quizVersion, reloadForNewQuiz],
  );

  const postJson = (url: string, body: unknown) =>
    fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // Notify the server when a question is shown (timing and live stats).
  // An answer waits for this request, so the server always gets them in order.
  const notifyQuestionStart = (questionId: number) => {
    questionStartRef.current = postJson("api/question-start", {
      user_id: userIdRef.current,
      question_id: questionId,
    }).catch((error) => console.log("Failed to notify question start:", error));
    return questionStartRef.current;
  };

  const stopCountdown = () => window.clearInterval(countdownRef.current);

  const showClientResults = () => {
    setResults({ client: [...clientResultsRef.current] });
    setPhase("results");
  };

  const fetchAndShowFinalResults = async () => {
    try {
      // The same data as after a page reload, so both screens look the same
      const response = await fetchWithRetry(`api/verify-user/${userIdRef.current}`);
      const data: VerifyResponse = await response.json();
      if (response.ok && data.valid && data.test_completed && data.final_results) {
        setResults({ final: data.final_results });
        setPhase("results");
      } else {
        showClientResults();
      }
    } catch (error) {
      console.error("Error fetching final results from server:", error);
      showClientResults();
    }
  };

  const showQuestion = async () => {
    const all = questionsRef.current;
    if (answeredCount(all) === all.length) {
      stopCountdown();
      await fetchAndShowFinalResults();
      return;
    }
    const question = all[currentRef.current];
    setSelected([]);
    setTextAnswer(question.type === "text" ? question.default_value || "" : "");
    setFeedback(null);
    setMode("answering");
    setSkipBusy(false);
    setContinueBusy(false);
  };

  const finishByTimeout = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    stopCountdown();
    showTestError(t.time_is_up);
    try {
      await postJson("api/finish-test", { user_id: userIdRef.current, reason: "timeout" });
    } catch {
      console.warn("Failed to notify server about timeout");
    }
    await fetchAndShowFinalResults();
  };

  // The server already finished the test (an answer came after the time limit)
  const showResultsAfterTimeout = async () => {
    stopCountdown();
    finishingRef.current = true;
    await fetchAndShowFinalResults();
  };

  const startCountdown = () => {
    const deadline = deadlineRef.current;
    if (!deadline) {
      setRemaining(null);
      return;
    }
    // Recomputed from the deadline each tick, so throttled background timers do not add time
    const tick = () => {
      const seconds = remainingSeconds(deadline, Date.now());
      setRemaining(seconds);
      if (seconds <= 0) {
        stopCountdown();
        finishByTimeout();
      }
    };
    const seconds = remainingSeconds(deadline, Date.now());
    if (seconds <= 0) {
      finishByTimeout();
      return;
    }
    setRemaining(seconds);
    countdownRef.current = window.setInterval(tick, 1000);
  };

  const startTest = async () => {
    clientResultsRef.current = [];
    setPhase("test");
    startCountdown();
    await showQuestion();
  };

  const applyVerifyState = (data: VerifyResponse) => {
    setAllowSkip(!!data.allow_skip_questions);
    deadlineRef.current = deadlineFrom(data.time_limit, data.remaining_seconds, Date.now());
    setQuestions(applyServerState(questionsRef.current, data));
  };

  const checkApprovalStatus = async () => {
    if (!userIdRef.current || checkingApprovalRef.current) return;
    // One check at a time: while the connection is down, more checks would start the quiz several times
    checkingApprovalRef.current = true;
    hideWaitingError();
    try {
      const response = await fetchWithRetry(`api/verify-user/${userIdRef.current}`);
      const data: VerifyResponse = await response.json();
      if (response.ok && data.valid) {
        if (data.approved) {
          window.clearInterval(approvalTimerRef.current);
          applyVerifyState(data);
          setQuestions(applyQuestionOrder(questionsRef.current, data.question_order));
          setCurrent(0);
          await startTest();
          await notifyQuestionStart(questionsRef.current[0].id);
        }
      } else {
        showWaitingError(data.message || t.status_check_error);
      }
    } catch (error) {
      showWaitingError(t.error_prefix + (error as Error).message);
    } finally {
      checkingApprovalRef.current = false;
    }
  };

  const showWaitingForApproval = () => {
    setPhase("waiting");
    window.clearInterval(approvalTimerRef.current);
    approvalTimerRef.current = window.setInterval(checkApprovalStatus, APPROVAL_POLL_MS);
  };

  // Page load: resume the stored user, or show the registration form
  useEffect(() => {
    // Preload every quiz image while the student fills the registration form
    for (const question of page.questions) {
      const urls = [question.image, ...(question.options || []).filter(isImagePath)];
      urls.filter(isImagePath).forEach((url) => {
        new Image().src = relativePath(url!);
      });
    }

    const resume = async () => {
      const storedUserId = getCookie("user_id");
      if (!storedUserId) {
        setPhase("registration");
        return;
      }
      try {
        // Retries until the server answers instead of falling back to the registration form
        const response = await fetchWithRetry(`api/verify-user/${storedUserId}`);
        const data: VerifyResponse = await response.json();
        if (!response.ok || !data.valid) {
          setPhase("registration");
          return;
        }
        userIdRef.current = data.user_id;
        setUsername(data.username);
        setQuestions(applyQuestionOrder(questionsRef.current, data.question_order));
        if (data.requires_approval && !data.approved) {
          showWaitingForApproval();
        } else if (data.test_completed && data.final_results) {
          setResults({ final: data.final_results });
          setPhase("results");
        } else {
          applyVerifyState(data);
          setCurrent(pickQuestionIndex(questionsRef.current, data.next_question_index ?? 0));
          await startTest();
          await notifyQuestionStart(questionsRef.current[currentRef.current].id);
        }
      } catch {
        setPhase("registration");
      }
    };
    resume();

    // Pages that stay open without requests learn about a new quiz by polling its version
    const poll = page.quizVersion
      ? window.setInterval(async () => {
          try {
            const response = await fetch("api/quiz-version", { cache: "no-store" });
            if (!response.ok) return;
            const data = await response.json();
            if (data.quiz_version && data.quiz_version !== page.quizVersion) reloadForNewQuiz();
          } catch {
            // No connection: the next poll tries again
          }
        }, QUIZ_VERSION_POLL_MS)
      : undefined;

    return () => {
      window.clearInterval(poll);
      window.clearInterval(approvalTimerRef.current);
      stopCountdown();
    };
    // Runs once on page load
  }, []);

  const registerUser = async () => {
    const name = (fieldRefs.current.username?.value || "").trim();
    if (!name) {
      showRegistrationError(t.please_enter_username);
      return;
    }
    const registrationData: Record<string, string> = { username: name };
    for (const field of page.registrationFields) {
      const value = (fieldRefs.current[field.name]?.value || "").trim();
      if (!value) {
        showRegistrationError(t.please_fill_field.replace("{field}", field.label));
        return;
      }
      registrationData[field.name] = value;
    }
    hideRegistrationError();
    // Disabled so a slow or retried request is not sent twice
    setRegistering(true);
    try {
      const response = await postJson("api/register", { ...registrationData, registration_token: generateRequestToken() });
      const data = await response.json();
      if (!response.ok) {
        showRegistrationError(data.error || t.registration_error);
        return;
      }
      userIdRef.current = data.user_id;
      setUsername(data.username);
      setAllowSkip(!!data.allow_skip_questions);
      setCookie("user_id", data.user_id);
      deadlineRef.current = deadlineFrom(data.time_limit, undefined, Date.now());
      saveRegistrationData(registrationData);
      setQuestions(applyQuestionOrder(questionsRef.current, data.question_order));
      if (data.requires_approval && !data.approved) {
        showWaitingForApproval();
      } else {
        setCurrent(0); // A new user starts from the beginning
        await startTest();
        await notifyQuestionStart(questionsRef.current[0].id);
      }
    } catch (error) {
      showRegistrationError(t.error_prefix + (error as Error).message);
    } finally {
      setRegistering(false);
    }
  };

  const continueToQuestion = async (target: number | null = null) => {
    setContinueBusy(true);
    const all = questionsRef.current;
    // Leaving a question without an answer keeps it reachable from the navigation bar
    let updated = all;
    if (all[currentRef.current].status !== "answered") {
      updated = all.map((question, i) => (i === currentRef.current ? { ...question, status: "skipped" as const } : question));
      setQuestions(updated);
    }
    if (target !== null) {
      if (target >= 0 && target < updated.length) setCurrent(target);
    } else {
      setCurrent(nextQuestionIndex(updated, currentRef.current));
    }
    // Only when a question is actually opened
    if (answeredCount(updated) < updated.length) notifyQuestionStart(updated[currentRef.current].id);
    await showQuestion();
  };

  const selectAnswer = (optionIndex: number) => {
    const question = questionsRef.current[currentRef.current];
    if (answerLocked || mode !== "answering" || question.status === "answered") return;
    if (question.is_multiple_choice) {
      setSelected((list) => (list.includes(optionIndex) ? list.filter((i) => i !== optionIndex) : [...list, optionIndex]));
    } else {
      // Clicking the selected option again clears the selection
      setSelected((list) => (list[0] === optionIndex ? [] : [optionIndex]));
    }
  };

  const errorFromResponse = async (response: Response): Promise<{ timeIsUp: boolean; message: string }> => {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return { timeIsUp: !!data.time_is_up, message: data.error || text };
    } catch {
      return { timeIsUp: false, message: text };
    }
  };

  const skipQuestion = async () => {
    setSkipBusy(true);
    try {
      const all = questionsRef.current;
      const index = currentRef.current;
      if (skipNeedsRequest(all, index)) {
        // Timing for this question starts with the question-start request, send it first
        await questionStartRef.current;
        const response = await postJson("api/skip-question", { user_id: userIdRef.current, question_id: all[index].id });
        if (!response.ok) {
          const error = await errorFromResponse(response);
          if (error.timeIsUp) {
            await showResultsAfterTimeout();
            return;
          }
          throw new Error(error.message);
        }
        setQuestions(all.map((question, i) => (i === index ? { ...question, status: "skipped" as const } : question)));
      }
      setMode("advancing");
      // A brief pause before the next question
      await sleep(100);
      await continueToQuestion();
    } catch (error) {
      showTestError(t.skip_error + (error as Error).message);
      setSkipBusy(false);
    }
  };

  const submitAnswer = async () => {
    const index = currentRef.current;
    const question = questionsRef.current[index];
    const isText = question.type === "text";
    if (isText ? !textAnswer.trim() : selected.length === 0) {
      showTestError(isText ? t.please_enter_answer : question.is_multiple_choice ? t.please_select_at_least_one : t.please_select_answer);
      return;
    }
    hideTestError();
    // Locked: a retried request sends the same answer, so it must not change
    setAnswerLocked(true);
    const answer: Answer = isText ? textAnswer : question.is_multiple_choice ? [...selected].sort((a, b) => a - b) : selected[0];
    let locked = true;
    try {
      // Timing for this question starts with the question-start request, send it first
      await questionStartRef.current;
      const response = await postJson("api/submit-answer", {
        user_id: userIdRef.current,
        question_id: question.id,
        selected_answer: answer,
      });
      if (!response.ok) {
        const error = await errorFromResponse(response);
        if (error.timeIsUp) {
          await showResultsAfterTimeout();
          return;
        }
        throw new Error(error.message);
      }
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
      }

      const options = question.options || [];
      clientResultsRef.current.push({
        question: question.question,
        image: question.image,
        file: question.file,
        selectedAnswer: isText ? textAnswer : Array.isArray(answer) ? answer.map((i) => options[i]).join(" | ") : options[answer as number],
        isCorrect: data.is_correct !== undefined ? data.is_correct : null,
        correctAnswer: null,
      });
      setQuestions(
        questionsRef.current.map((q, i) => (i === index ? { ...q, status: "answered" as const, selectedAnswer: answer } : q)),
      );

      if (data.is_correct === undefined) {
        // show_right_answer is false: no feedback, move on by itself
        setMode("advancing");
        locked = false;
        setAnswerLocked(false);
        await sleep(100);
        await continueToQuestion();
        return;
      }
      setFeedback({
        isCorrect: data.is_correct,
        correctAnswer: data.correct_answer,
        checkerError: data.checker_error,
        correctValue: data.correct_value,
      });
      setMode("feedback");
    } catch (error) {
      showTestError(t.submit_error + (error as Error).message);
    } finally {
      if (locked) setAnswerLocked(false);
    }
  };


  // ----- Rendering -----

  const question = questions[current];
  const isText = question?.type === "text";
  const isAnswered = question?.status === "answered";
  const optionsDisabled = isAnswered || mode !== "answering";
  const storedChoice = isAnswered
    ? Array.isArray(question.selectedAnswer)
      ? question.selectedAnswer
      : [question.selectedAnswer as number]
    : selected;
  const skipMode = phase === "test" && question ? skipButtonMode(questions, current, allowSkip) : "hidden";
  const submitDisabled = isAnswered || answerLocked || (isText ? !textAnswer.trim() : selected.length === 0);
  const points = question?.points || 1;

  const optionClass = (optionIndex: number) => {
    const classes = ["option", "quiz-option"];
    if (storedChoice.includes(optionIndex)) classes.push("selected");
    if (feedback && !isText) {
      if (question.is_multiple_choice) {
        const correct = Array.isArray(feedback.correctAnswer) ? feedback.correctAnswer : [];
        if (selected.includes(optionIndex)) classes.push(correct.includes(optionIndex) ? "feedback-correct" : "feedback-incorrect");
        else if (correct.includes(optionIndex)) classes.push("feedback-missed");
      } else if (selected[0] === optionIndex) {
        classes.push(feedback.isCorrect ? "feedback-correct" : "feedback-incorrect");
      } else if (!feedback.isCorrect && feedback.correctAnswer === optionIndex) {
        classes.push("feedback-correct");
      }
    }
    if (optionsDisabled) classes.push("disabled");
    return classes.join(" ");
  };

  const labels = {
    "--t-correct": JSON.stringify(t.correct_answer_label),
    "--t-yours": JSON.stringify(t.your_answer_label),
    "--t-also": JSON.stringify(t.also_correct_label),
  } as CSSProperties;

  const bannerText = quizChangedText || (waitingRequests > 0 ? t.connection_lost : "");
  const savedRegistration = useMemo(loadRegistrationData, []);
  const level = remaining !== null ? timerLevel(remaining) : "";

  return (
    <>
      <img src="img/top-left.png" className="corner-image top-left" alt="" />
      <img src="img/top-right.png" className="corner-image top-right" alt="" />
      <div id="connection-banner" className={`connection-banner${bannerText ? "" : " hidden"}`} role="status">
        {bannerText}
      </div>
      <div className="container" style={labels}>
        <div className="top-right-controls">
          <div className={`user-info${username ? " visible" : ""}`} id="user-info">
            👤 <span id="username-display">{username}</span>
          </div>
        </div>
        <h1>{page.title}</h1>

        <div id="loading" className={`section${phase === "loading" ? "" : " hidden"}`}>
          <h2>{t.loading}</h2>
          <p>{t.checking_data}</p>
        </div>

        <div id="registration" className={`section${phase === "registration" ? "" : " hidden"}`}>
          <h2>{t.register_title}</h2>
          <ErrorMessage id="registration-error" message={registrationError} />
          <table className="registration-table">
            <tbody>
              <tr>
                <td className="registration-label">{`${page.usernameLabel}:`}</td>
                <td className="registration-input">
                  <input
                    type="text"
                    id="username"
                    defaultValue={savedRegistration.username || ""}
                    ref={(element) => {
                      fieldRefs.current.username = element;
                    }}
                    onKeyDown={(event) => event.key === "Enter" && registerUser()}
                  />
                </td>
              </tr>
              {page.registrationFields.map((field) => (
                <tr key={field.name}>
                  <td className="registration-label">{`${field.label}:`}</td>
                  <td className="registration-input">
                    <input
                      type="text"
                      className="registration-field"
                      data-field-name={field.name}
                      defaultValue={savedRegistration[field.name] || ""}
                      ref={(element) => {
                        fieldRefs.current[field.name] = element;
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: "center", marginTop: 15 }}>
            <button className="register-btn" onClick={registerUser} disabled={registering}>
              {t.register_button}
            </button>
          </div>
        </div>

        <div id="waiting-approval" className={`section${phase === "waiting" ? "" : " hidden"}`}>
          <p style={{ textAlign: "center", color: "var(--text-color)", margin: "20px 0" }}>{t.waiting_description}</p>
          <ErrorMessage id="waiting-error" message={waitingError} />
        </div>

        <div id="test-section" className={`section${phase === "test" ? "" : " hidden"}`}>
          <div
            id="timer"
            className={`user-info${remaining !== null ? " visible" : ""}${level ? ` ${level}` : ""}`}
            style={{ display: remaining !== null ? undefined : "none" }}
          >
            ⏳ <span id="timer-value">{remaining !== null ? formatTimer(remaining) : ""}</span>
          </div>
          <ErrorMessage id="test-error" message={testError} />
          <div id="current-question-container" onCopy={(event) => event.preventDefault()}>
            {phase === "test" && question && (
              <div
                key={question.id}
                className="current-question active-question"
                style={{ position: "relative" }}
              >
                {points !== 1 && (
                  <div className="question-points-badge">
                    🏆 {formatPoints(points)} {pointsWord(points, t)}
                  </div>
                )}
                {question.question && <h3 className="question-text" dangerouslySetInnerHTML={html(question.question)} />}
                {question.image && (
                  <a href={relativePath(question.image)} target="_blank" rel="noreferrer">
                    <img src={relativePath(question.image)} alt="Question image" className="question-image quiz-question-img" />
                  </a>
                )}
                {question.file && (
                  <a href={relativePath(question.file)} download className="question-file">
                    <span className="question-file-icon">📎</span>
                    <span className="question-file-name">{question.file.split("/").pop()}</span>
                  </a>
                )}
                {isText ? (
                  <div className="text-input-container">
                    <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 10 }}>{t.enter_answer_label}</p>
                    <textarea
                      id="text-answer-input"
                      className={`text-answer-input${feedback ? (feedback.isCorrect ? " feedback-correct" : " feedback-incorrect") : ""}`}
                      placeholder={t.enter_answer_placeholder}
                      value={isAnswered && mode === "answering" ? String(question.selectedAnswer ?? "") : textAnswer}
                      disabled={isAnswered || answerLocked || mode !== "answering"}
                      onChange={(event) => setTextAnswer(event.target.value)}
                    />
                    <div id="checker-feedback">
                      {feedback && !feedback.isCorrect && feedback.checkerError && (
                        <div className="checker-error">⚠️ {feedback.checkerError}</div>
                      )}
                      {feedback && !feedback.isCorrect && feedback.correctValue && (
                        <div className="correct-value-display">
                          {t.correct_answer_value}
                          <pre style={{ margin: "5px 0 0 0", whiteSpace: "pre-wrap" }}>{feedback.correctValue}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="options">
                    {question.is_multiple_choice && (
                      <p className="multiple-choice-hint" style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 10 }}>
                        {t.multiple_choice_hint}
                      </p>
                    )}
                    {(question.options || []).map((option, optionIndex) => (
                      <div
                        key={optionIndex}
                        id={`option_${optionIndex}`}
                        className={optionClass(optionIndex)}
                        data-option-index={optionIndex}
                        onClick={() => selectAnswer(optionIndex)}
                      >
                        {isImagePath(option) ? (
                          <div className="option-content">
                            <img src={relativePath(option)} alt={`Option ${optionIndex + 1}`} className="option-image" />
                          </div>
                        ) : (
                          <span dangerouslySetInnerHTML={html(option)} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="button-container">
            <button
              id="submit-answer-btn"
              className={mode === "answering" ? undefined : "hidden"}
              onClick={submitAnswer}
              disabled={submitDisabled}
            >
              {t.submit_answer}
            </button>
            <button
              id="continue-btn"
              className={mode === "feedback" ? undefined : "hidden"}
              onClick={() => continueToQuestion()}
              disabled={continueBusy}
            >
              {t.continue_button}
            </button>
            <button
              id="skip-question-btn"
              className={`action${skipMode !== "hidden" && mode === "answering" ? "" : " hidden"}`}
              onClick={skipQuestion}
              disabled={skipBusy}
            >
              {skipMode === "next" ? t.next_button : t.skip_short}
            </button>
          </div>
          <div id="nav">
            {phase === "test" &&
              questions.map((q, index) => {
                const isCurrent = index === current;
                return (
                  <button
                    key={q.id}
                    className={`q-btn ${isCurrent ? "current" : q.status}`}
                    onClick={() => !isCurrent && q.status !== "unseen" && continueToQuestion(index)}
                  >
                    {index + 1}
                  </button>
                );
              })}
          </div>
        </div>

        <div id="results" className={`section${phase === "results" ? "" : " hidden"}`}>
          <div id="results-content">
            {results?.final && (
              <FinalResultsView
                results={results.final}
                totalQuestions={questions.length}
                showFinalList={page.showFinalList}
                showRightAnswer={page.showRightAnswer}
                t={t}
              />
            )}
            {results?.client && (
              <ClientResultsView
                results={results.client}
                showFinalList={page.showFinalList}
                showRightAnswer={page.showRightAnswer}
                t={t}
              />
            )}
          </div>
        </div>
      </div>
      <div className="page-footer">WebQuiz v{version}</div>
    </>
  );
}

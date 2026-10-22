import { formatPoints, isImagePath, relativePath } from "./logic";

// Results of a finished test as verify-user returns them (final_results)
export interface FinalResults {
  correct_count: number;
  percentage: number;
  mark: string | number;
  earned_points?: number;
  total_points?: number;
  points_percentage?: number;
  show_answers_on_completion?: boolean;
  all_completed?: boolean;
  test_results: {
    question?: string;
    image?: string;
    file?: string;
    selected_answer?: string;
    correct_answer?: string;
    is_correct?: boolean;
    points?: number;
    earned_points?: number;
  }[];
}

// Results collected by the page itself, used when the server cannot be asked
export interface ClientResult {
  question?: string;
  image?: string;
  file?: string;
  selectedAnswer: string;
  isCorrect: boolean | null;
  correctAnswer: string | null;
}

// Question text may contain HTML written by the quiz author
function Html({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function QuestionCell({ question, image, file, fallback }: { question?: string; image?: string; file?: string; fallback: string }) {
  const hasImage = isImagePath(image);
  const hasFile = isImagePath(file);
  if (!question && !hasImage && !hasFile) return <>{image || file || fallback}</>;
  return (
    <>
      {question && <Html html={question} />}
      {hasImage && (
        <>
          {question && <br />}
          <img
            src={relativePath(image!)}
            alt="Question image"
            style={{ maxWidth: 200, maxHeight: 150, borderRadius: 5 }}
          />
        </>
      )}
      {hasFile && (
        <>
          {(question || hasImage) && <br />}
          <a
            href={relativePath(file!)}
            download
            className="question-file"
            style={{ display: "inline-flex", marginTop: 5, padding: "5px 10px", fontSize: 12 }}
          >
            <span className="question-file-icon">📎</span>
            <span className="question-file-name">{file!.split("/").pop()}</span>
          </a>
        </>
      )}
    </>
  );
}

// Several answers are joined with " | "; image answers are shown as images
function AnswerCell({ answer }: { answer?: string }) {
  if (!answer) return null;
  const parts = answer.includes("|") ? answer.split("|").map((part) => part.trim()) : [answer];
  const render = (part: string) =>
    isImagePath(part) ? (
      <img
        src={relativePath(part)}
        alt="Answer option"
        style={{ maxWidth: 100, maxHeight: 75, borderRadius: 3 }}
      />
    ) : (
      <Html html={part} />
    );
  if (parts.length === 1) return render(parts[0]);
  return (
    <>
      {parts.map((part, i) => (
        <div key={i} style={{ margin: "2px 0" }}>
          {render(part)}
        </div>
      ))}
    </>
  );
}

const correctnessClass = (isCorrect: boolean | null | undefined) =>
  isCorrect === true ? "answer-correct" : isCorrect === false ? "answer-incorrect" : "";

export function FinalResultsView({
  results,
  totalQuestions,
  showFinalList,
  showRightAnswer,
  t,
}: {
  results: FinalResults;
  totalQuestions: number;
  showFinalList: boolean;
  showRightAnswer: boolean;
  t: Record<string, string>;
}) {
  const rows = results.test_results;
  const waitForAnswers = !!results.show_answers_on_completion && !results.all_completed;
  // is_correct is left out while the answers are hidden
  const hasCorrectAnswers = rows.length > 0 && rows[0].is_correct !== undefined;
  const hasCustomPoints = rows.some((row) => (row.points || 1) !== 1);

  return (
    <>
      <p>
        <strong>{t.result_label}</strong> {results.correct_count}/{totalQuestions} ({results.percentage}%)
      </p>
      <p>
        <strong>{t.mark_label}</strong> {results.mark}
      </p>
      {hasCustomPoints && (
        <p>
          <strong>{t.points_label}</strong> {formatPoints(results.earned_points || 0)}/
          {formatPoints(results.total_points || totalQuestions)} ({results.points_percentage || results.percentage}%)
        </p>
      )}
      {waitForAnswers && (
        <div
          style={{
            background: "var(--stats-bg)",
            padding: 15,
            borderRadius: 5,
            margin: "15px 0",
            borderLeft: "4px solid #2196f3",
          }}
        >
          <p style={{ margin: "0 0 10px 0" }}>
            <strong>{t.answers_available_later}</strong>
          </p>
          <p style={{ margin: "0 0 10px 0", fontSize: 14 }}>{t.reload_later}</p>
          <button
            onClick={() => location.reload()}
            style={{ background: "#2196f3", fontSize: 14, margin: 0 }}
          >
            {t.reload_page}
          </button>
        </div>
      )}
      {showFinalList && (
        <table className="results-table">
          <thead>
            <tr>
              <th style={{ textAlign: "center" }}>{t.number_header}</th>
              <th>{t.question_header}</th>
              <th>{t.your_answer_header}</th>
              <th style={{ textAlign: "center" }}>{t.correct_header_alt}</th>
              {hasCustomPoints && <th style={{ textAlign: "center" }}>{t.points_header}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td data-label={t.number_header} style={{ textAlign: "center" }}>
                  {index + 1}
                </td>
                <td data-label={t.question_header}>
                  <QuestionCell question={row.question} image={row.image} file={row.file} fallback={t.no_question_content} />
                </td>
                <td data-label={t.your_answer_header}>
                  <span className={correctnessClass(row.is_correct)}>
                    <AnswerCell answer={row.selected_answer} />
                  </span>
                  {row.is_correct === false &&
                    row.correct_answer &&
                    row.selected_answer &&
                    (showRightAnswer || hasCorrectAnswers) && (
                      <div className="correct-answer-hint">
                        {t.result_correct_header}
                        <AnswerCell answer={row.correct_answer} />
                      </div>
                    )}
                </td>
                <td data-label={t.correct_header_alt} style={{ textAlign: "center" }}>
                  {row.is_correct !== undefined ? (
                    <span className={row.is_correct ? "correct" : "incorrect"} style={{ fontSize: 18 }}>
                      {row.is_correct ? "✓" : "✗"}
                    </span>
                  ) : (
                    <span style={{ color: "#666" }}>{t.unknown}</span>
                  )}
                </td>
                {hasCustomPoints && (
                  <td data-label={t.points_header} style={{ textAlign: "center" }}>
                    {formatPoints(row.earned_points !== undefined ? row.earned_points : row.is_correct ? row.points || 1 : 0)}/
                    {formatPoints(row.points || 1)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function ClientResultsView({
  results,
  showFinalList,
  showRightAnswer,
  t,
}: {
  results: ClientResult[];
  showFinalList: boolean;
  showRightAnswer: boolean;
  t: Record<string, string>;
}) {
  const correct = results.filter((result) => result.isCorrect === true).length;
  const percentage = results.length ? Math.round((correct / results.length) * 100) : 0;
  return (
    <>
      <p>
        <strong>{t.result_label}</strong> {correct}/{results.length} ({percentage}%)
      </p>
      {showFinalList && (
        <table className="results-table">
          <thead>
            <tr>
              <th>{t.question_header}</th>
              <th>{t.your_answer_header}</th>
              <th style={{ textAlign: "center" }}>{t.correct_header}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={index}>
                <td data-label={t.question_header}>
                  <QuestionCell question={result.question} image={result.image} file={result.file} fallback={t.no_question_content} />
                </td>
                <td data-label={t.your_answer_header}>
                  <span className={correctnessClass(result.isCorrect)}>
                    <AnswerCell answer={result.selectedAnswer} />
                  </span>
                  {result.isCorrect === false && result.correctAnswer && showRightAnswer && (
                    <div className="correct-answer-hint">
                      {t.result_correct_header}
                      <AnswerCell answer={result.correctAnswer} />
                    </div>
                  )}
                </td>
                <td data-label={t.correct_header_alt} style={{ textAlign: "center" }}>
                  {result.isCorrect !== null ? (
                    <span className={result.isCorrect ? "correct" : "incorrect"} style={{ fontSize: 18 }}>
                      {result.isCorrect ? "✓" : "✗"}
                    </span>
                  ) : (
                    <span style={{ color: "#666" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

import type { ReactNode } from "react";
import { Alert, Card, Flex, Grid, Progress, Table, Tag, Typography } from "antd";
import { LoadingOutlined, PaperClipOutlined } from "@ant-design/icons";
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
            className="question-file question-file-small"
          >
            <PaperClipOutlined className="question-file-icon" />
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

// One row of the results list, the same for server and client results
interface Row {
  question?: string;
  image?: string;
  file?: string;
  answer?: string;
  correctAnswer?: string | null;
  isCorrect: boolean | null | undefined;
  // Correct answer hint under a wrong answer
  showHint: boolean;
  points?: string;
}

function CorrectMark({ isCorrect, unknown }: { isCorrect: boolean | null | undefined; unknown: string }) {
  if (isCorrect === undefined || isCorrect === null) return <Typography.Text type="secondary">{unknown}</Typography.Text>;
  return (
    <Tag color={isCorrect ? "success" : "error"} className={isCorrect ? "correct" : "incorrect"} style={{ marginInlineEnd: 0 }}>
      {isCorrect ? "✓" : "✗"}
    </Tag>
  );
}

function AnswerWithHint({ row, t }: { row: Row; t: Record<string, string> }) {
  return (
    <>
      <span className={correctnessClass(row.isCorrect)}>
        <AnswerCell answer={row.answer} />
      </span>
      {row.showHint && (
        <div className="correct-answer-hint">
          {t.result_correct_header}
          <AnswerCell answer={row.correctAnswer || undefined} />
        </div>
      )}
    </>
  );
}

// Table on wide screens, a card per question on phones
function ResultsList({
  rows,
  numbered,
  withPoints,
  t,
}: {
  rows: Row[];
  numbered: boolean;
  withPoints: boolean;
  t: Record<string, string>;
}) {
  const mobile = Grid.useBreakpoint().md === false;
  const unknown = numbered ? t.unknown : "—";

  if (mobile) {
    return (
      <Flex vertical gap={10} className="results-table results-cards">
        {rows.map((row, index) => (
          <Card
            key={index}
            size="small"
            className={`result-card${row.isCorrect === true ? " ok" : row.isCorrect === false ? " fail" : ""}`}
          >
            <Flex justify="space-between" align="flex-start" gap={8}>
              <div className="result-question">
                {numbered && <Typography.Text strong>{index + 1}. </Typography.Text>}
                <QuestionCell question={row.question} image={row.image} file={row.file} fallback={t.no_question_content} />
              </div>
              <Flex gap={4} align="center">
                {withPoints && row.points && <Tag style={{ marginInlineEnd: 0 }}>{row.points}</Tag>}
                <CorrectMark isCorrect={row.isCorrect} unknown={unknown} />
              </Flex>
            </Flex>
            <div className="result-answer">
              <Typography.Text type="secondary">{t.your_answer_header}: </Typography.Text>
              <AnswerWithHint row={row} t={t} />
            </div>
          </Card>
        ))}
      </Flex>
    );
  }

  return (
    <Table<Row & { key: number }>
      className="results-table"
      size="middle"
      pagination={false}
      dataSource={rows.map((row, index) => ({ ...row, key: index }))}
      columns={[
        ...(numbered
          ? [
              {
                key: "n",
                title: t.number_header,
                width: 50,
                align: "center" as const,
                render: (_: unknown, __: Row, index: number) => index + 1,
              },
            ]
          : []),
        {
          key: "question",
          title: t.question_header,
          render: (_, row) => (
            <QuestionCell question={row.question} image={row.image} file={row.file} fallback={t.no_question_content} />
          ),
        },
        { key: "answer", title: t.your_answer_header, render: (_, row) => <AnswerWithHint row={row} t={t} /> },
        {
          key: "correct",
          title: numbered ? t.correct_header_alt : t.correct_header,
          align: "center",
          width: 110,
          render: (_, row) => <CorrectMark isCorrect={row.isCorrect} unknown={unknown} />,
        },
        ...(withPoints
          ? [{ key: "points", title: t.points_header, width: 80, align: "center" as const, dataIndex: "points" }]
          : []),
      ]}
    />
  );
}

function Summary({ percent, children }: { percent: number; children: ReactNode }) {
  const mobile = Grid.useBreakpoint().md === false;
  return (
    <Flex align="center" justify="center" gap={24} wrap className="results-summary">
      <Progress type="circle" percent={percent} size={mobile ? 110 : 130} status="normal" />
      <Flex vertical gap={4}>
        {children}
      </Flex>
    </Flex>
  );
}

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
  const waitForAnswers = !!results.show_answers_on_completion && !results.all_completed;
  // is_correct is left out while the answers are hidden
  const hasCorrectAnswers = results.test_results.length > 0 && results.test_results[0].is_correct !== undefined;
  const hasCustomPoints = results.test_results.some((row) => (row.points || 1) !== 1);
  const rows: Row[] = results.test_results.map((row) => ({
    question: row.question,
    image: row.image,
    file: row.file,
    answer: row.selected_answer,
    correctAnswer: row.correct_answer,
    isCorrect: row.is_correct,
    showHint:
      row.is_correct === false && !!row.correct_answer && !!row.selected_answer && (showRightAnswer || hasCorrectAnswers),
    points: `${formatPoints(row.earned_points !== undefined ? row.earned_points : row.is_correct ? row.points || 1 : 0)}/${formatPoints(row.points || 1)}`,
  }));

  return (
    <Flex vertical gap={20}>
      <Summary percent={hasCustomPoints ? results.points_percentage || results.percentage : results.percentage}>
        <Typography.Title level={2} className="result-mark" style={{ margin: 0 }}>
          {t.mark_label} {results.mark}
        </Typography.Title>
        <Typography.Text className="result-score">
          <strong>{t.result_label}</strong> {results.correct_count}/{totalQuestions} ({results.percentage}%)
        </Typography.Text>
        {hasCustomPoints && (
          <Typography.Text className="result-points">
            <strong>{t.points_label}</strong> {formatPoints(results.earned_points || 0)}/
            {formatPoints(results.total_points || totalQuestions)} ({results.points_percentage || results.percentage}%)
          </Typography.Text>
        )}
      </Summary>
      {waitForAnswers && (
        <Alert
          type="info"
          showIcon
          icon={<LoadingOutlined />}
          className="answers-later"
          title={t.answers_available_later}
          description={t.answers_refresh_note}
        />
      )}
      {showFinalList && <ResultsList rows={rows} numbered withPoints={hasCustomPoints} t={t} />}
    </Flex>
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
  const rows: Row[] = results.map((result) => ({
    question: result.question,
    image: result.image,
    file: result.file,
    answer: result.selectedAnswer,
    correctAnswer: result.correctAnswer,
    isCorrect: result.isCorrect,
    showHint: result.isCorrect === false && !!result.correctAnswer && showRightAnswer,
  }));
  return (
    <Flex vertical gap={20}>
      <Summary percent={percentage}>
        <Typography.Text className="result-score">
          <strong>{t.result_label}</strong> {correct}/{results.length} ({percentage}%)
        </Typography.Text>
      </Summary>
      {showFinalList && <ResultsList rows={rows} numbered={false} withPoints={false} t={t} />}
    </Flex>
  );
}

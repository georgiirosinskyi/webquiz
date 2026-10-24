import { useEffect, useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckOutlined,
  EditOutlined,
  ReloadOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { apiSend } from "../shared/api";
import { t, tn } from "../shared/i18n";
import { formatPoints } from "../shared/points";
import { STATE_STYLES, formatTime, stateLabel } from "../shared/questionState";
import { isImagePath } from "../quiz/logic";
import {
  STATUS_LABELS,
  USER_SORTERS,
  answerRows,
  averagePercent,
  fieldSorter,
  countUsers,
  filterOverviewUsers,
  formatDuration,
  liveTimes,
  progressSummary,
  registrationFieldNames,
  sortUsers,
  userNumbers,
  type OverviewFilter,
} from "./overview";
import { fieldNameToLabel, type AdminUser, type CurrentQuiz, type QuizInfo } from "./types";

// The progress bar uses solid colors, the result tags the pale STATE_STYLES backgrounds
const BAR_COLORS = { ok: "#52c41a", fail: "#ff4d4f", skip: "#faad14" };

// Ticks every second so the timers of running tests move.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function CurrentQuizCard({
  quiz,
  quizzes,
  users,
  onEdit,
}: {
  quiz: CurrentQuiz | null;
  quizzes: QuizInfo[];
  users: AdminUser[];
  onEdit: (filename: string) => void;
}) {
  const { message, modal } = App.useApp();
  const counts = countUsers(users);
  const average = averagePercent(users);
  const current = quiz?.filename || null;

  const switchTo = (filename: string) => {
    const restart = filename === current;
    modal.confirm({
      title: restart ? t("overview.restart_title") : t("overview.switch_title", { name: filename }),
      content: users.length > 0 ? t("overview.reset_users", { count: users.length }) : t("overview.new_csv"),
      okText: restart ? t("overview.restart") : t("overview.switch"),
      onOk: async () => {
        const result = await apiSend<{ run: string }>("POST", "/api/admin/switch-quiz", { quiz_filename: filename });
        if (result.ok) {
          message.success(
            t(restart ? "overview.restarted" : "overview.switched", { name: filename, csv: result.data.run }),
          );
        } else {
          message.error(result.data.error || t("overview.switch_failed"));
        }
      },
    });
  };

  const forceAnswers = () =>
    modal.confirm({
      title: t("overview.force_title"),
      content: t("overview.force_content"),
      okText: t("overview.force_ok"),
      onOk: async () => {
        const result = await apiSend<{ completed_count: number; total_count: number }>(
          "POST",
          "/api/admin/force-show-answers",
        );
        if (!result.ok) message.error(result.data.error || t("overview.force_failed"));
      },
    });

  return (
    <Card data-testid="current-quiz-card">
      <Flex justify="space-between" align="flex-start" wrap gap={12}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <Typography.Text type="secondary">{t("overview.current_quiz")}</Typography.Text>
          <Typography.Title level={4} style={{ margin: "2px 0 4px" }} data-testid="current-quiz-title">
            {quiz ? quiz.title || quiz.filename : t("overview.no_quiz")}
          </Typography.Title>
        </div>
        <Space wrap>
          <Select
            showSearch
            value={current}
            placeholder={t("overview.choose_quiz")}
            style={{ width: 280, maxWidth: "100%" }}
            optionFilterProp="search"
            popupMatchSelectWidth={false}
            onChange={(value: string) => value !== current && switchTo(value)}
            options={quizzes.map((item) => ({
              value: item.filename,
              search: `${item.filename} ${item.title || ""}`,
              label: (
                <span>
                  {item.title || item.filename}
                  {item.title && <Typography.Text type="secondary"> · {item.filename}</Typography.Text>}
                </span>
              ),
            }))}
            data-testid="quiz-select"
          />
          <Button icon={<EditOutlined />} disabled={!current} onClick={() => current && onEdit(current)}>
            {t("common.edit")}
          </Button>
          <Button icon={<ReloadOutlined />} disabled={!current} onClick={() => current && switchTo(current)} data-testid="restart-btn">
            {t("overview.restart")}
          </Button>
        </Space>
      </Flex>

      {quiz && (
        <Flex justify="space-between" align="center" wrap gap={6} style={{ marginTop: 12 }}>
          <Space wrap size={[6, 6]}>
            <Tag className="quiz-param">{tn("plural.questions", quiz.total_questions)}</Tag>
            <Tag className="quiz-param">{tn("plural.points", quiz.total_points, { n: formatPoints(quiz.total_points) })}</Tag>
            {quiz.time_limit > 0 && <Tag className="quiz-param" color="orange">⏱ {formatDuration(quiz.time_limit)}</Tag>}
            {quiz.randomize_questions && <Tag className="quiz-param" color="purple">{t("overview.shuffle")}</Tag>}
            {quiz.allow_skip_questions && <Tag className="quiz-param" color="cyan">{t("overview.can_skip")}</Tag>}
            {quiz.requires_approval && <Tag className="quiz-param" color="gold">{t("overview.needs_approval")}</Tag>}
          </Space>
          {quiz.show_answers_on_completion &&
            (quiz.force_all_completed ? (
              <Tag className="quiz-param" color="green" data-testid="answers-opened">
                {t("overview.answers_opened")}
              </Tag>
            ) : (
              <Button size="small" icon={<UnlockOutlined />} onClick={forceAnswers} data-testid="force-answers-btn">
                {t("overview.open_answers")}
              </Button>
            ))}
        </Flex>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }} data-testid="overview-stats">
        <Col xs={12} sm={8} md={4}>
          <Statistic title={t("overview.registered")} value={counts.all} />
        </Col>
        <Col xs={12} sm={8} md={5}>
          <Statistic title={t("overview.waiting")} value={counts.pending} styles={{ content: counts.pending ? { color: "#d48806" } : undefined }} />
        </Col>
        <Col xs={12} sm={8} md={5}>
          <Statistic title={t("overview.in_progress")} value={counts.in_progress} styles={{ content: { color: "#1677ff" } }} />
        </Col>
        <Col xs={12} sm={12} md={5}>
          <Statistic title={t("overview.finished")} value={counts.finished} styles={{ content: { color: "#389e0d" } }} />
        </Col>
        <Col xs={24} sm={12} md={5}>
          <Statistic title={t("overview.average")} value={average === null ? "—" : `${average}%`} />
        </Col>
      </Row>
    </Card>
  );
}

// One bar (green correct, red wrong, yellow skipped) and the counts
function ProgressSummary({ user, quiz }: { user: AdminUser; quiz: CurrentQuiz | null }) {
  const total = quiz?.total_questions || user.question_order.length;
  const summary = progressSummary(user);
  const width = (count: number) => `${(count / Math.max(total, 1)) * 100}%`;
  return (
    <Flex vertical gap={2} className="progress-summary" data-testid="progress-summary">
      <span className="progress-summary-bar">
        <span style={{ width: width(summary.ok), background: BAR_COLORS.ok }} />
        <span style={{ width: width(summary.fail), background: BAR_COLORS.fail }} />
        <span style={{ width: width(summary.skip), background: BAR_COLORS.skip }} />
      </span>
      <Flex justify="space-between" gap={8} className="progress-summary-counts">
        <span>
          <Typography.Text type="success">✓ {summary.ok}</Typography.Text>{" "}
          <Typography.Text type="danger">✗ {summary.fail}</Typography.Text>
          {summary.skip > 0 && <Typography.Text type="warning"> ⏭ {summary.skip}</Typography.Text>}
        </span>
        <Typography.Text>
          {user.answered}/{total}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}

// Option texts one per line; image options as small pictures
function AnswerParts({ parts, type }: { parts: string[]; type?: "success" | "danger" }) {
  return (
    <Flex vertical gap={2}>
      {parts.map((part, index) =>
        isImagePath(part) ? (
          <img key={index} src={part} alt="" className="answer-image" />
        ) : (
          <Typography.Text key={index} type={type} className="answer-text">
            {part}
          </Typography.Text>
        ),
      )}
    </Flex>
  );
}

function UserDetails({ user, quiz }: { user: AdminUser; quiz: CurrentQuiz | null }) {
  return (
    <Flex vertical gap={8}>
      {Object.keys(user.registration_fields || {}).length > 0 && (
        <Space wrap size={[16, 4]}>
          {Object.entries(user.registration_fields).map(([key, value]) => (
            <span key={key}>
              <Typography.Text type="secondary">{fieldNameToLabel(key)}:</Typography.Text> {value}
            </span>
          ))}
        </Space>
      )}
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        scroll={{ x: "max-content" }}
        dataSource={answerRows(user, quiz)}
        columns={[
          { key: "position", title: t("common.number"), dataIndex: "position", width: 50 },
          {
            key: "question",
            title: t("overview.col_question"),
            className: "answer-question",
            render: (_, row) => row.question || t("overview.question_n", { n: row.id }),
          },
          {
            key: "answer",
            title: t("overview.col_answer"),
            className: "answer-cell",
            render: (_, row) =>
              row.answer ? (
                <AnswerParts
                  parts={row.answer}
                  type={row.state === "ok" ? "success" : row.state === "fail" ? "danger" : undefined}
                />
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            key: "correct",
            title: t("overview.col_correct"),
            className: "answer-cell",
            render: (_, row) => <AnswerParts parts={row.correct} />,
          },
          {
            key: "state",
            title: t("overview.col_result"),
            width: 130,
            responsive: ["sm"],
            render: (_, row) => (
              <Tag style={{ ...STATE_STYLES[row.state], border: "none" }}>{stateLabel(row.state)}</Tag>
            ),
          },
          {
            key: "time",
            title: t("overview.col_time"),
            width: 80,
            responsive: ["sm"],
            render: (_, row) => formatTime(row.time_taken) || "",
          },
        ]}
      />
    </Flex>
  );
}

function UsersTable({
  users,
  numbers,
  quiz,
  now,
  onApprove,
}: {
  users: AdminUser[];
  // Fixed number of every user (registration order), not the row position
  numbers: Map<string, number>;
  quiz: CurrentQuiz | null;
  now: number;
  onApprove: (userId: string) => void;
}) {
  const fieldNames = registrationFieldNames(users);

  const columns: ColumnsType<AdminUser> = [
    {
      key: "index",
      title: t("common.number"),
      width: 48,
      responsive: ["sm"],
      sorter: (a, b) => (numbers.get(a.user_id) || 0) - (numbers.get(b.user_id) || 0),
      render: (_, user) => numbers.get(user.user_id),
    },
    {
      key: "username",
      title: t("overview.col_user"),
      sorter: USER_SORTERS.username,
      render: (_, user) => (
        <Typography.Text strong className="username-text">
          {user.username}
        </Typography.Text>
      ),
    },
    ...fieldNames.map((name) => ({
      key: `field-${name}`,
      title: fieldNameToLabel(name),
      responsive: ["md" as const],
      sorter: fieldSorter(name, quiz?.field_options?.[name]),
      render: (_: unknown, user: AdminUser) => user.registration_fields?.[name] || "",
    })),
    {
      key: "status",
      title: t("overview.col_status"),
      sorter: USER_SORTERS.status,
      render: (_, user) => (
        <Tag color={STATUS_LABELS[user.status].color} data-testid="user-status" data-status={user.status}>
          {t(STATUS_LABELS[user.status].key)}
        </Tag>
      ),
    },
    {
      key: "progress",
      title: t("overview.col_progress"),
      sorter: USER_SORTERS.progress,
      sortDirections: ["descend", "ascend"],
      render: (_, user) =>
        // The dash takes the height of the bar with the counts, so approving a user does not change the row height
        user.status === "pending" ? <div className="progress-placeholder">—</div> : <ProgressSummary user={user} quiz={quiz} />,
    },
    {
      key: "points",
      title: t("overview.col_points"),
      sorter: USER_SORTERS.points,
      sortDirections: ["descend", "ascend"],
      render: (_, user) =>
        user.status === "pending" ? "—" : `${formatPoints(user.earned_points)}/${formatPoints(quiz?.total_points || 0)}`,
    },
    {
      key: "mark",
      title: t("overview.col_mark"),
      responsive: ["sm"],
      sorter: USER_SORTERS.mark,
      sortDirections: ["descend", "ascend"],
      render: (_, user) => (user.mark === null ? "—" : <Typography.Text strong>{user.mark}</Typography.Text>),
    },
    {
      key: "time",
      title: t("overview.col_time"),
      responsive: ["sm"],
      sorter: USER_SORTERS.time,
      render: (_, user) => {
        const { elapsed, remaining } = liveTimes(user, now);
        return (
          <Flex vertical>
            <span>{elapsed === null ? "—" : formatDuration(elapsed)}</span>
            {remaining !== null ? (
              <Typography.Text type={remaining <= 60 ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                {t("overview.time_left", { time: formatDuration(remaining) })}
              </Typography.Text>
            ) : (
              // Keeps the row height before approval and after the test ends, when there is no "time left"
              quiz && quiz.time_limit > 0 && <span style={{ fontSize: 12 }}>{" "}</span>
            )}
          </Flex>
        );
      },
    },
    {
      key: "actions",
      title: "",
      width: 1,
      render: (_, user) =>
        user.status === "pending" && (
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              onApprove(user.user_id);
            }}
            data-testid="approve-btn"
          >
            {t("overview.approve")}
          </Button>
        ),
    },
  ];

  return (
    <Table<AdminUser>
      data-testid="users-table"
      rowKey="user_id"
      size="small"
      columns={columns}
      dataSource={users}
      pagination={users.length > 100 ? { pageSize: 100 } : false}
      scroll={{ x: "max-content" }}
      rowClassName={(user) => (user.status === "pending" ? "row-pending" : "")}
      expandable={{
        expandedRowRender: (user) => <UserDetails user={user} quiz={quiz} />,
        rowExpandable: (user) => user.status !== "pending",
        expandRowByClick: true,
      }}
    />
  );
}

export function OverviewPage({
  quiz,
  users,
  quizzes,
  onEdit,
}: {
  quiz: CurrentQuiz | null;
  users: AdminUser[];
  quizzes: QuizInfo[];
  onEdit: (filename: string) => void;
}) {
  const { message } = App.useApp();
  const now = useNow();
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [search, setSearch] = useState("");

  const sorted = useMemo(() => sortUsers(users), [users]);
  const numbers = useMemo(() => userNumbers(users), [users]);
  const visible = useMemo(() => filterOverviewUsers(sorted, filter, search), [sorted, filter, search]);
  const counts = countUsers(users);
  const pendingIds = users.filter((user) => user.status === "pending").map((user) => user.user_id);

  const approve = async (userId: string) => {
    try {
      const result = await apiSend("PUT", "/api/admin/approve-user", { user_id: userId });
      if (!result.ok) message.error(result.data.error || t("overview.approve_failed"));
    } catch (error) {
      message.error(t("common.connection_error", { error: (error as Error).message }));
    }
  };

  const filterOption = (value: OverviewFilter, label: string, count: number) => ({
    value,
    label: (
      <Space size={6}>
        {label}
        <Badge
          count={count}
          showZero
          color={value === "pending" && count > 0 ? "#faad14" : filter === value ? "#1677ff" : "#bfbfbf"}
        />
      </Space>
    ),
  });

  return (
    <Flex vertical gap={16} data-testid="overview">
      <CurrentQuizCard quiz={quiz} quizzes={quizzes} users={users} onEdit={onEdit} />

      <Card styles={{ body: { padding: 12 } }}>
        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
          <Flex wrap gap={8} align="center">
            <Segmented<OverviewFilter>
              style={{ maxWidth: "100%", overflowX: "auto" }}
              value={filter}
              onChange={setFilter}
              options={[
                filterOption("all", t("overview.all"), counts.all),
                ...(quiz?.requires_approval || counts.pending > 0 ? [filterOption("pending", t("overview.waiting"), counts.pending)] : []),
                filterOption("in_progress", t("overview.in_progress"), counts.in_progress),
                filterOption("finished", t("overview.finished"), counts.finished),
              ]}
            />
            <Input.Search
              allowClear
              placeholder={t("overview.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 220 }}
            />
          </Flex>
          <Space wrap>
            {pendingIds.length > 0 && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => pendingIds.forEach(approve)} data-testid="approve-all-btn">
                {t("overview.approve_all", { count: pendingIds.length })}
              </Button>
            )}
          </Space>
        </Flex>

        {visible.length === 0 ? (
          <Empty
            style={{ padding: 32 }}
            description={users.length === 0 ? t("overview.no_users") : t("overview.no_users_in_filter")}
          />
        ) : (
          <UsersTable users={visible} numbers={numbers} quiz={quiz} now={now} onApprove={approve} />
        )}
      </Card>
    </Flex>
  );
}

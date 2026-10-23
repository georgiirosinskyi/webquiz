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
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckOutlined,
  EditOutlined,
  ExportOutlined,
  ReloadOutlined,
  TableOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { apiSend } from "../shared/api";
import { formatPoints } from "../shared/points";
import { STATE_STYLES, formatTime } from "../live-stats/stats";
import { Legend, LiveStatsTable } from "../live-stats/LiveStatsTable";
import {
  STATUS_LABELS,
  averagePercent,
  countUsers,
  filterOverviewUsers,
  formatDuration,
  liveTimes,
  progressCells,
  registrationFieldNames,
  sortUsers,
  toLiveState,
  type OverviewFilter,
} from "./overview";
import { fieldNameToLabel, type AdminUser, type CurrentQuiz, type QuizInfo } from "./types";

type View = "table" | "matrix";

const CELL_LABELS: Record<string, string> = {
  think: "відповідає",
  ok: "правильно",
  fail: "неправильно",
  skip: "пропущено",
  empty: "ще не відкрито",
};

// Progress dots use solid colors, the matrix cells the pale STATE_STYLES backgrounds
const DOT_COLORS: Record<string, string> = {
  think: "#1677ff",
  ok: "#52c41a",
  fail: "#ff4d4f",
  skip: "#faad14",
  empty: "#d9d9d9",
};

const LEGEND_UK: [keyof typeof STATE_STYLES, string][] = [
  ["think", "Відповідає"],
  ["ok", "Правильно"],
  ["fail", "Неправильно"],
  ["skip", "Пропущено"],
  ["empty", "Ще не відкрито"],
];

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
      title: restart ? "Перезапустити поточний тест?" : `Переключитися на "${filename}"?`,
      content:
        users.length > 0
          ? `Усі користувачі (${users.length}) та їхні відповіді будуть скинуті. Результати залишаться в CSV.`
          : "Буде створено новий CSV файл для результатів.",
      okText: restart ? "Перезапустити" : "Переключитися",
      onOk: async () => {
        const result = await apiSend<{ csv_file: string }>("POST", "/api/admin/switch-quiz", { quiz_filename: filename });
        if (result.ok) {
          message.success(`${restart ? "Перезапущено" : "Переключено на"} "${filename}". CSV: ${result.data.csv_file}`);
        } else {
          message.error(result.data.error || "Не вдалося переключити тест");
        }
      },
    });
  };

  const forceAnswers = () =>
    modal.confirm({
      title: "Відкрити відповіді для всіх користувачів?",
      content: "Цю дію неможливо скасувати (до перезапуску тесту).",
      okText: "Відкрити",
      onOk: async () => {
        const result = await apiSend<{ completed_count: number; total_count: number }>(
          "POST",
          "/api/admin/force-show-answers",
        );
        if (!result.ok) message.error(result.data.error || "Помилка відкриття відповідей");
      },
    });

  return (
    <Card data-testid="current-quiz-card">
      <Flex justify="space-between" align="flex-start" wrap gap={12}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <Typography.Text type="secondary">Поточний тест</Typography.Text>
          <Typography.Title level={4} style={{ margin: "2px 0 4px" }} data-testid="current-quiz-title">
            {quiz ? quiz.title || quiz.filename : "Тест не вибрано"}
          </Typography.Title>
          {current && (
            <Typography.Text code data-testid="current-quiz-file">
              {current}
            </Typography.Text>
          )}
        </div>
        <Space wrap>
          <Select
            showSearch
            value={current}
            placeholder="Обрати тест"
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
            Редагувати
          </Button>
          <Button icon={<ReloadOutlined />} disabled={!current} onClick={() => current && switchTo(current)} data-testid="restart-btn">
            Перезапустити
          </Button>
          <Button icon={<ExportOutlined />} href="/live-stats/" target="_blank">
            На проєктор
          </Button>
        </Space>
      </Flex>

      {quiz && (
        <Space wrap size={[6, 6]} style={{ marginTop: 12 }}>
          <Tag>{quiz.total_questions} питань</Tag>
          <Tag>{formatPoints(quiz.total_points)} балів</Tag>
          {quiz.time_limit > 0 && <Tag color="orange">⏱ {formatDuration(quiz.time_limit)}</Tag>}
          {quiz.randomize_questions && <Tag color="purple">🔀 Перемішування</Tag>}
          {quiz.allow_skip_questions && <Tag color="cyan">⏭ Можна пропускати</Tag>}
          {quiz.requires_approval && <Tag color="gold">✋ Потрібне підтвердження</Tag>}
          {quiz.show_answers_on_completion &&
            (quiz.force_all_completed ? (
              <Tag color="green" data-testid="answers-opened">
                Відповіді відкрито
              </Tag>
            ) : (
              <Button size="small" icon={<UnlockOutlined />} onClick={forceAnswers} data-testid="force-answers-btn">
                Відкрити відповіді для всіх
              </Button>
            ))}
        </Space>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }} data-testid="overview-stats">
        <Col xs={12} sm={8} md={4}>
          <Statistic title="Зареєстровано" value={counts.all} />
        </Col>
        <Col xs={12} sm={8} md={5}>
          <Statistic title="Чекають" value={counts.pending} styles={{ content: counts.pending ? { color: "#d48806" } : undefined }} />
        </Col>
        <Col xs={12} sm={8} md={5}>
          <Statistic title="Проходять" value={counts.in_progress} styles={{ content: { color: "#1677ff" } }} />
        </Col>
        <Col xs={12} sm={12} md={5}>
          <Statistic title="Завершили" value={counts.finished} styles={{ content: { color: "#389e0d" } }} />
        </Col>
        <Col xs={24} sm={12} md={5}>
          <Statistic title="Середній бал" value={average === null ? "—" : `${average}%`} />
        </Col>
      </Row>
    </Card>
  );
}

function ProgressDots({ user, quiz }: { user: AdminUser; quiz: CurrentQuiz | null }) {
  const total = quiz?.total_questions || user.question_order.length;
  return (
    <Flex align="center" gap={8} wrap>
      <span className="progress-dots">
        {progressCells(user).map((cell, index) => (
          <Tooltip key={cell.id} title={`${index + 1}: ${CELL_LABELS[cell.state]}`}>
            <span
              className="progress-dot"
              data-state={cell.state}
              style={{ background: DOT_COLORS[cell.state] }}
            />
          </Tooltip>
        ))}
      </span>
      <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
        {user.answered}/{total}
      </Typography.Text>
    </Flex>
  );
}

function UserDetails({ user, quiz }: { user: AdminUser; quiz: CurrentQuiz | null }) {
  const questions = new Map((quiz?.questions || []).map((question) => [question.id, question]));
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
        dataSource={progressCells(user).map((cell, index) => ({ ...cell, position: index + 1 }))}
        columns={[
          { key: "position", title: "№", dataIndex: "position", width: 50 },
          {
            key: "question",
            title: "Питання",
            render: (_, cell) => {
              const question = questions.get(cell.id);
              return question?.question || question?.image?.split("/").pop() || `Питання ${cell.id}`;
            },
          },
          {
            key: "state",
            title: "Результат",
            width: 150,
            render: (_, cell) => (
              <Tag style={{ ...STATE_STYLES[cell.state], border: "none" }}>{CELL_LABELS[cell.state]}</Tag>
            ),
          },
          {
            key: "time",
            title: "Час",
            width: 90,
            responsive: ["sm"],
            render: (_, cell) => formatTime(user.live_stats[String(cell.id)]?.time_taken) || "",
          },
        ]}
      />
    </Flex>
  );
}

function UsersTable({
  users,
  quiz,
  now,
  onApprove,
}: {
  users: AdminUser[];
  quiz: CurrentQuiz | null;
  now: number;
  onApprove: (userId: string) => void;
}) {
  const fieldNames = registrationFieldNames(users);

  const columns: ColumnsType<AdminUser> = [
    {
      key: "index",
      title: "№",
      width: 48,
      responsive: ["sm"],
      render: (_, __, index) => index + 1,
    },
    {
      key: "username",
      title: "Користувач",
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
      render: (_: unknown, user: AdminUser) => user.registration_fields?.[name] || "",
    })),
    {
      key: "status",
      title: "Статус",
      render: (_, user) => (
        <Tag color={STATUS_LABELS[user.status].color} data-testid="user-status" data-status={user.status}>
          {STATUS_LABELS[user.status].text}
        </Tag>
      ),
    },
    {
      key: "progress",
      title: "Прогрес",
      render: (_, user) => (user.status === "pending" ? "—" : <ProgressDots user={user} quiz={quiz} />),
    },
    {
      key: "points",
      title: "Бали",
      render: (_, user) =>
        user.status === "pending" ? "—" : `${formatPoints(user.earned_points)}/${formatPoints(quiz?.total_points || 0)}`,
    },
    {
      key: "mark",
      title: "Оцінка",
      responsive: ["sm"],
      render: (_, user) => (user.mark === null ? "—" : <Typography.Text strong>{user.mark}</Typography.Text>),
    },
    {
      key: "time",
      title: "Час",
      responsive: ["sm"],
      render: (_, user) => {
        const { elapsed, remaining } = liveTimes(user, now);
        if (elapsed === null) return "—";
        return (
          <Flex vertical>
            <span>{formatDuration(elapsed)}</span>
            {remaining !== null && (
              <Typography.Text type={remaining <= 60 ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                залишилось {formatDuration(remaining)}
              </Typography.Text>
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
            Підтвердити
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
  const [view, setView] = useState<View>("table");

  const sorted = useMemo(() => sortUsers(users), [users]);
  const visible = useMemo(() => filterOverviewUsers(sorted, filter, search), [sorted, filter, search]);
  const counts = countUsers(users);
  const pendingIds = users.filter((user) => user.status === "pending").map((user) => user.user_id);

  const approve = async (userId: string) => {
    try {
      const result = await apiSend("PUT", "/api/admin/approve-user", { user_id: userId });
      if (!result.ok) message.error(result.data.error || "Помилка підтвердження");
    } catch (error) {
      message.error(`Помилка з'єднання: ${(error as Error).message}`);
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
                filterOption("all", "Усі", counts.all),
                ...(quiz?.requires_approval || counts.pending > 0 ? [filterOption("pending", "Чекають", counts.pending)] : []),
                filterOption("in_progress", "Проходять", counts.in_progress),
                filterOption("finished", "Завершили", counts.finished),
              ]}
            />
            <Input.Search
              allowClear
              placeholder="Пошук користувача"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 220 }}
            />
          </Flex>
          <Space wrap>
            {pendingIds.length > 0 && (
              <Button type="primary" icon={<CheckOutlined />} onClick={() => pendingIds.forEach(approve)} data-testid="approve-all-btn">
                Підтвердити всіх ({pendingIds.length})
              </Button>
            )}
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: "table", icon: <UnorderedListOutlined />, label: "Таблиця" },
                { value: "matrix", icon: <TableOutlined />, label: "Матриця" },
              ]}
            />
          </Space>
        </Flex>

        {visible.length === 0 ? (
          <Empty
            style={{ padding: 32 }}
            description={users.length === 0 ? "Користувачі ще не зареєструвалися" : "Немає користувачів у цій категорії"}
          />
        ) : view === "table" ? (
          <UsersTable users={visible} quiz={quiz} now={now} onApprove={approve} />
        ) : (
          <Flex vertical gap={12}>
            <LiveStatsTable
              state={toLiveState(visible, quiz)}
              visible={visible.filter((user) => user.status !== "pending").map((user) => user.user_id)}
              userTitle="Користувач"
            />
            <Legend items={LEGEND_UK} />
          </Flex>
        )}
      </Card>
    </Flex>
  );
}

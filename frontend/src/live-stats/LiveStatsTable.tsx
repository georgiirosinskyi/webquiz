import type { HTMLAttributes } from "react";
import { Flex, Grid, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleFilled, SyncOutlined } from "@ant-design/icons";
import { formatPoints } from "../shared/points";
import {
  STATE_STYLES,
  computeStats,
  formatTime,
  questionPoints,
  type CellState,
  type LiveState,
  type Question,
  type QuestionStats,
} from "./stats";
import "./live-stats.css";

export const STATE_ICONS: Record<CellState, string> = {
  think: "🔵",
  ok: "🟢",
  fail: "🔴",
  skip: "🟡",
  empty: "⚪",
};

export const LEGEND: [CellState, string][] = [
  ["think", "Answering"],
  ["ok", "Correct"],
  ["fail", "Incorrect"],
  ["skip", "Skipped"],
  ["empty", "Not reached"],
];

function QuestionHeader({ question, index, stats }: { question: Question; index: number; stats: QuestionStats }) {
  const points = questionPoints(question);
  const imageOnly = question.image && !question.question;
  const label = imageOnly
    ? question.image!.split("/").pop()!.split(".").slice(0, -1).join(".")
    : question.question || `Q${index + 1}`;
  const hint = `${label} - Correct: ${stats.correct}/${stats.attempts}${points !== 1 ? ` - ${formatPoints(points)} points` : ""}`;

  return (
    <Tooltip title={hint}>
      <Flex vertical align="center" gap={4}>
        {imageOnly && <img src={question.image} alt={label} className="header-image" />}
        <Typography.Text strong className="question-text">
          {label}
        </Typography.Text>
        <Space size={4} wrap style={{ justifyContent: "center" }}>
          <Tag variant="filled" style={{ marginInlineEnd: 0 }}>
            {stats.correct}/{stats.attempts}
          </Tag>
          {question.file && <span title={question.file.split("/").pop()}>📎</span>}
          {points !== 1 && (
            <span data-testid="points-indicator" className="points-indicator" title={`${formatPoints(points)} points`}>
              🏆 {formatPoints(points)}
            </span>
          )}
        </Space>
      </Flex>
    </Tooltip>
  );
}

// Users x questions grid: a colored cell per answer, the score next to each user.
export function LiveStatsTable({
  state,
  visible,
  scrollY,
  userTitle = "User",
}: {
  state: LiveState;
  visible: string[];
  scrollY?: string;
  userTitle?: string;
}) {
  const screens = Grid.useBreakpoint();
  const mobile = screens.md === false;
  const stats = computeStats(state);

  const columns: ColumnsType<string> = [
    {
      key: "user",
      title: userTitle,
      fixed: "left",
      width: mobile ? 120 : 200,
      render: (_, userId) => {
        const userStats = stats.users[userId];
        return (
          <Flex vertical gap={4}>
            <Typography.Text strong className="username-text">
              {state.users[userId]}
            </Typography.Text>
            <Flex align="center" justify="space-between" gap={6}>
              {state.completed[userId] ? (
                <CheckCircleFilled style={{ color: "#52c41a" }} title="Completed" />
              ) : (
                <SyncOutlined style={{ color: "#1677ff" }} title="In progress" />
              )}
              <Tag variant="filled" style={{ marginInlineEnd: 0 }} data-testid="user-score">
                {formatPoints(userStats?.earnedPoints || 0)}/{formatPoints(state.totalPoints)}
              </Tag>
            </Flex>
          </Flex>
        );
      },
    },
    ...state.questions.map((question, index) => {
      const questionId = index + 1;
      const cellState = (userId: string): CellState => state.liveStats[userId]?.[questionId]?.state || "empty";
      return {
        key: `q${questionId}`,
        title: (
          <QuestionHeader
            question={question}
            index={index}
            stats={stats.questions[questionId] || { correct: 0, attempts: 0 }}
          />
        ),
        width: mobile ? 80 : 130,
        align: "center" as const,
        onCell: (userId: string) =>
          ({
            style: { ...STATE_STYLES[cellState(userId)], fontWeight: 600 },
            "data-state": cellState(userId),
          }) as HTMLAttributes<HTMLElement>,
        render: (_: unknown, userId: string) => {
          const time = formatTime(state.liveStats[userId]?.[questionId]?.time_taken);
          return (
            <Flex vertical align="center">
              <span style={{ fontSize: mobile ? 14 : 18, lineHeight: 1 }}>{STATE_ICONS[cellState(userId)]}</span>
              {time && <span style={{ fontSize: mobile ? 9 : 11, fontWeight: 400, opacity: 0.8 }}>{time}</span>}
            </Flex>
          );
        },
      };
    }),
  ];

  return (
    <Table<string>
      rowKey={(userId) => userId}
      dataSource={visible}
      columns={columns}
      pagination={false}
      bordered
      size="small"
      scroll={{ x: "max-content", y: scrollY }}
    />
  );
}

export function Legend({ items = LEGEND }: { items?: [CellState, string][] }) {
  return (
    <Flex wrap gap={8}>
      {items.map(([cellState, label]) => (
        <Tag key={cellState} style={{ ...STATE_STYLES[cellState], border: "none" }}>
          {STATE_ICONS[cellState]} {label}
        </Tag>
      ))}
    </Flex>
  );
}

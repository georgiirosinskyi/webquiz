import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Flex, Grid, Layout, Segmented, Space, Typography } from "antd";
import { SyncOutlined } from "@ant-design/icons";
import { filterUsers, type Filter } from "./stats";
import { Legend, LiveStatsTable } from "./LiveStatsTable";
import { useLiveStatsSocket, type ConnectionStatus } from "./useLiveStatsSocket";

function ConnectionAlert({
  status,
  maxAttempts,
  onReconnect,
}: {
  status: ConnectionStatus;
  maxAttempts: number;
  onReconnect: () => void;
}) {
  if (status.kind === "connected") return null;
  if (status.kind === "reconnecting") {
    return (
      <Alert
        type="info"
        showIcon
        icon={<SyncOutlined spin />}
        title={`Disconnected from server. Reconnecting in ${status.delaySeconds}s... (${status.attempt}/${maxAttempts})`}
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      title="Failed to reconnect to the server."
      action={
        <Button size="small" onClick={onReconnect}>
          Reconnect
        </Button>
      }
    />
  );
}

export function LiveStatsPage() {
  const { state, status, reconnect, maxAttempts } = useLiveStatsSocket();
  const [filter, setFilter] = useState<Filter>("all");
  const screens = Grid.useBreakpoint();
  const mobile = screens.md === false;

  const { visible, counts } = useMemo(() => filterUsers(state, filter), [state, filter]);

  const filterOption = (value: Filter, label: string, count: number) => ({
    value,
    label: (
      <Space size={6}>
        {label}
        <Badge count={count} showZero color={filter === value ? "#1677ff" : "#bfbfbf"} />
      </Space>
    ),
  });

  return (
    <Layout style={{ minHeight: "100vh", padding: mobile ? 10 : 20 }}>
      <Flex vertical gap={16} style={{ width: "100%" }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Live Stats
            </Typography.Title>
            {state.currentQuiz && <Typography.Text type="secondary">{state.currentQuiz}</Typography.Text>}
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              filterOption("all", "All", counts.all),
              filterOption("inProgress", "In Progress", counts.inProgress),
              filterOption("completed", "Completed", counts.completed),
            ]}
          />
        </Flex>

        <ConnectionAlert status={status} maxAttempts={maxAttempts} onReconnect={reconnect} />

        <Card styles={{ body: { padding: 0 } }}>
          {visible.length === 0 ? (
            <Empty
              style={{ padding: 40 }}
              description={
                counts.all === 0 ? "Waiting for users to join the quiz..." : "No users in this category yet."
              }
            />
          ) : (
            <LiveStatsTable state={state} visible={visible} scrollY="calc(100vh - 240px)" />
          )}
        </Card>

        <Legend />
      </Flex>
    </Layout>
  );
}

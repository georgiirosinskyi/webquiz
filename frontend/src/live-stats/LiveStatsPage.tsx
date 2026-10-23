import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Flex, Grid, Layout, Segmented, Space, Typography } from "antd";
import { SyncOutlined } from "@ant-design/icons";
import { t } from "../shared/i18n";
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
        title={t("live.reconnecting", { seconds: status.delaySeconds, attempt: status.attempt, max: maxAttempts })}
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      title={t("live.failed")}
      action={
        <Button size="small" onClick={onReconnect}>
          {t("live.reconnect")}
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
              {t("live.title")}
            </Typography.Title>
            {state.currentQuiz && <Typography.Text type="secondary">{state.currentQuiz}</Typography.Text>}
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              filterOption("all", t("live.all"), counts.all),
              filterOption("inProgress", t("live.in_progress"), counts.inProgress),
              filterOption("completed", t("live.completed"), counts.completed),
            ]}
          />
        </Flex>

        <ConnectionAlert status={status} maxAttempts={maxAttempts} onReconnect={reconnect} />

        <Card styles={{ body: { padding: 0 } }}>
          {visible.length === 0 ? (
            <Empty
              style={{ padding: 40 }}
              description={
                counts.all === 0 ? t("live.waiting") : t("live.no_users")
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

import type { ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import ukUA from "antd/locale/uk_UA";
import { getServerData } from "./serverData";

// Light theme only (the fork has no dark theme).
const theme = {
  token: {
    colorPrimary: "#1677ff",
    borderRadius: 8,
  },
};

export function AppProvider({ children }: { children: ReactNode }) {
  const { language } = getServerData();
  return (
    <ConfigProvider theme={theme} locale={language === "en" ? enUS : ukUA}>
      <App>{children}</App>
    </ConfigProvider>
  );
}

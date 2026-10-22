import { Divider, Flex, Typography } from "antd";

const LINKS = [
  { href: "/admin/", label: "⚙️ Admin Panel" },
  { href: "/files/", label: "📁 File Manager" },
  { href: "/", label: "🏠 Quiz Home" },
  { href: "/live-stats/", label: "📊 Live Stats" },
];

// Navigation between the admin pages; the current page is left out.
export function AdminLinks({ current }: { current: string }) {
  return (
    <Flex justify="center" wrap style={{ marginTop: 24 }}>
      {LINKS.filter((link) => link.href !== current).map((link, index) => (
        <span key={link.href}>
          {index > 0 && <Divider orientation="vertical" />}
          <Typography.Link href={link.href} target={link.href === "/live-stats/" ? "_blank" : undefined}>
            {link.label}
          </Typography.Link>
        </span>
      ))}
    </Flex>
  );
}

import type { Metadata, Viewport } from "next";
import "../../styles/tailwind.css";
import "../../styles/app.global.scss";
import { StoreProvider } from "@/app/providers";

export const metadata: Metadata = {
  title: "庫藏 Archive — 收藏品庫存管理",
  description: "收藏品入庫、QR 標籤與掃碼出貨",
  manifest: "/site.webmanifest?v=3",
  icons: {
    icon: [
      {
        url: "/brand/archive-favicon-v3-16.png?v=3",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/brand/archive-favicon-v3-32.png?v=3",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/brand/archive-favicon-v3-48.png?v=3",
        sizes: "48x48",
        type: "image/png",
      },
    ],
    shortcut: "/brand/archive-favicon-v3-32.png?v=3",
    apple: {
      url: "/brand/archive-favicon-v3-180.png?v=3",
      sizes: "180x180",
      type: "image/png",
    },
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F1F5F9",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}

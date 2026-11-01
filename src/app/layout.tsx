import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { APP_FULL_NAME } from "@/lib/app-name";

export const metadata: Metadata = {
  title: { default: APP_FULL_NAME, template: `%s — ${APP_FULL_NAME}` },
  description: `Облік показників лічильників, внесків і оплат мешканців будинку: ${APP_FULL_NAME}`,
  applicationName: APP_FULL_NAME,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f3a5f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="uk" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}

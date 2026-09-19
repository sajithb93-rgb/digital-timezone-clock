
import "./globals.css";

export const metadata = {
  title: "QuantStructure",
  description: "Trading Analysis Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

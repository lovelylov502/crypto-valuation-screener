import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "크립토 재발견 스크리너",
  description:
    "DefiLlama·CoinMarketCap 공개 데이터로 펀더멘털 개선이 가격보다 앞선 크립토 후보를 찾는 리서치 스크리너",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

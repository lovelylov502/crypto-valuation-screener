import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "크립토 밸류에이션 리서치",
  description:
    "DefiLlama·CoinGecko 기반으로 크립토의 저평가·고평가 후보를 찾고 가치포획과 리스크를 검증하는 크립토 전용 리서치 도구",
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

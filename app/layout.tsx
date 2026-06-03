import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "크립토 밸류에이션 스크리너",
  description:
    "DefiLlama·CoinGecko 펀더멘털(매출·수수료·TVL) 기반으로 코인의 저평가/고평가를 섹터 정규화 점수로 보여주는 스크리너",
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

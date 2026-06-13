import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "토큰 가치포획 워크벤치",
  description:
    "DefiLlama·CoinGecko 기반으로 프로토콜 펀더멘털이 토큰 가치로 실제 연결되는지 판단하고 다음 리서치 질문을 뽑는 워크벤치",
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

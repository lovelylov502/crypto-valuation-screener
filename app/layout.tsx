import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "크립토 밸류에이션 리서치",
  description:
    "공개 데이터로 실적 개선, 홀더 배분과 현금흐름의 변화를 함께 살펴보는 크립토 스크리너",
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

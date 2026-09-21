import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const poppins = Poppins({ 
  subsets: ["latin"], 
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans" 
});

export const metadata: Metadata = {
  title: "Jev Memory Benchmark — TypeSafe AI Pipeline Evaluator",
  description:
    "Evaluate Jev (TypeSafe AI) as a semantic memory engine. Compare speed, cost, and accuracy against Gemini multi-shot and single-shot pipelines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${poppins.variable} font-sans antialiased bg-background text-foreground`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}

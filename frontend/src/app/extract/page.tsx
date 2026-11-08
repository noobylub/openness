import type { Metadata } from "next";
import { ExtractionStudio } from "@/components/ExtractionStudio";

export const metadata: Metadata = { title: "Extraction" };
export default function Page() {
  return <ExtractionStudio />;
}

import type { ChatRole } from "@/constants/chat";
import { PAIRNEST_API } from "@/constants/api";
import { AuthService } from "@/services/AuthService";

export type ReportType = "monthly" | "yearly";
export type ReportTone = "sky" | "rose" | "sunset" | "mint" | "violet";

export type ReportPage = {
  id: string;
  kind: "cover" | "metric" | "highlight" | "closing";
  eyebrow: string;
  title: string;
  body: string;
  metric?: number;
  unit?: string;
  detail?: string;
  icon: string;
  tone: ReportTone;
};

export type MemoryReport = {
  type: ReportType;
  period: string;
  role: ChatRole;
  title: string;
  subtitle: string;
  pages: ReportPage[];
  generatedByAi: boolean;
  generatedAt: string;
  updatedAt: string;
};

class ReportServiceImpl {
  async getReport(
    type: ReportType,
    period: string,
    role: ChatRole,
    options: { refresh?: boolean } = {},
  ) {
    const query = [
      `type=${encodeURIComponent(type)}`,
      `period=${encodeURIComponent(period)}`,
      `role=${encodeURIComponent(role)}`,
      ...(options.refresh ? ["refresh=1"] : []),
    ].join("&");
    const response = await AuthService.fetch(`${PAIRNEST_API.reports}?${query}`);
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      report?: MemoryReport;
      message?: string;
    };
    if (!response.ok || !data.ok || !data.report) {
      throw new Error(data.message || "生成回忆报告失败");
    }
    return data.report;
  }
}

export const ReportService = new ReportServiceImpl();

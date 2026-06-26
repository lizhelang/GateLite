import type { DashboardPayload } from "../../shared/types";
import { TrafficOverview } from "../components/TrafficOverview";
import { RuntimePage } from "./RuntimePage";

interface DashboardPageProps {
  dashboard: DashboardPayload | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function DashboardPage({ dashboard, loading, onRefresh }: DashboardPageProps) {
  return (
    <section className="grid gap-4">
      <TrafficOverview dashboard={dashboard} loading={loading} />

      {dashboard ? <RuntimePage dashboard={dashboard} onRefresh={onRefresh} embedded /> : null}
    </section>
  );
}

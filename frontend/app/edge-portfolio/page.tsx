import EdgePortfolioPage from "@/components/pages/EdgePortfolioPage";
import { listEdgeStrategies } from "@/lib/edgePortfolioStore";

export const dynamic = "force-dynamic";

export default async function Page() {
  const strategies = await listEdgeStrategies();
  return <EdgePortfolioPage initialStrategies={strategies} />;
}

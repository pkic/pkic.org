export function ActivityChartCard({ chart }: { chart: string }) {
  return (
    <div class="card border-0 shadow-sm mt-3">
      <div class="card-body">
        <h6 class="text-uppercase small fw-bold text-muted mb-3">Activity — last 30 days</h6>
        <div dangerouslySetInnerHTML={{ __html: chart }} />
      </div>
    </div>
  );
}

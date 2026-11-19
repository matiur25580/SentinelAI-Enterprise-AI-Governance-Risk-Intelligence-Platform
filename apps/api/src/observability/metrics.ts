const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

type Aggregate = {
  count: number;
  sum: number;
  bucketCounts: number[];
};

const requests = new Map<string, number>();
const durations = new Map<string, Aggregate>();

function labels(method: string, route: string, statusCode?: number): string {
  // Callers pass only HTTP methods and route templates, never raw paths.
  return JSON.stringify(statusCode === undefined ? [method, route] : [method, route, statusCode]);
}

export function recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  const key = labels(method, route, statusCode);
  requests.set(key, (requests.get(key) ?? 0) + 1);

  const durationKey = labels(method, route);
  let aggregate = durations.get(durationKey);
  if (!aggregate) {
    aggregate = { count: 0, sum: 0, bucketCounts: buckets.map(() => 0) };
    durations.set(durationKey, aggregate);
  }

  const seconds = Math.max(0, durationMs / 1000);
  aggregate.count += 1;
  aggregate.sum += seconds;
  buckets.forEach((bound, index) => {
    if (seconds <= bound) aggregate!.bucketCounts[index] += 1;
  });
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export function renderPrometheusMetrics(): string {
  const lines = [
    "# HELP sentinelai_http_requests_total Total completed HTTP requests.",
    "# TYPE sentinelai_http_requests_total counter",
  ];

  for (const [key, value] of requests) {
    const [method, route, statusCode] = JSON.parse(key) as [string, string, number];
    lines.push(`sentinelai_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_code="${statusCode}"} ${value}`);
  }

  lines.push(
    "# HELP sentinelai_http_request_duration_seconds HTTP request duration in seconds.",
    "# TYPE sentinelai_http_request_duration_seconds histogram",
  );

  for (const [key, aggregate] of durations) {
    const [method, route] = JSON.parse(key) as [string, string];
    const base = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
    buckets.forEach((bound, index) => {
      lines.push(`sentinelai_http_request_duration_seconds_bucket{${base},le="${bound}"} ${aggregate.bucketCounts[index]}`);
    });
    lines.push(`sentinelai_http_request_duration_seconds_bucket{${base},le="+Inf"} ${aggregate.count}`);
    lines.push(`sentinelai_http_request_duration_seconds_sum{${base}} ${aggregate.sum}`);
    lines.push(`sentinelai_http_request_duration_seconds_count{${base}} ${aggregate.count}`);
  }

  return `${lines.join("\n")}\n`;
}

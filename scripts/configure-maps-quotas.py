#!/usr/bin/env python3
"""Inspect or apply the AI Map daily quotas. Does not enable any service.

Requires gcloud login and serviceusage.quotas.get/update. Tokens stay in memory.
Without --apply this is read-only. Daily limits apply to the entire project.
"""

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


TARGETS = {
    "maps-backend.googleapis.com": {"billable_default": 50},
    # Legacy combines searches and details into one counter.
    "places-backend.googleapis.com": {"billable_default": 40},
    "places.googleapis.com": {"SearchTextRequest": 10, "GetPlaceRequest": 30},
    "routes.googleapis.com": {
        "compute_routes_requests": 20,
        "compute_route_matrix_elements": 30,
    },
}
BASE = "https://serviceusage.googleapis.com/v1beta1/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--allow-below-usage", action="store_true",
                        help="Allow a daily cap below recent usage; API access may stop until reset")
    args = parser.parse_args()
    gcloud_flags = [f"--account={args.account}", f"--project={args.project}"]
    project_number = subprocess.check_output(
        ["gcloud", "projects", "describe", args.project,
         "--format=value(projectNumber)", *gcloud_flags], text=True
    ).strip()
    if not project_number.isdigit():
        raise RuntimeError("Could not resolve project number")
    token = subprocess.check_output(
        ["gcloud", "auth", "print-access-token", *gcloud_flags], text=True
    ).strip()

    def request(path, method="GET", body=None, query=None):
        url = BASE + path
        if query:
            url += "?" + urllib.parse.urlencode(query, doseq=True)
        req = urllib.request.Request(
            url, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + token,
                     "x-goog-user-project": args.project,
                     "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            message = json.loads(error.read()).get("error", {}).get("message", "")
            raise RuntimeError(f"Service Usage HTTP {error.code}: {message}") from None

    # Discover all targets before making any changes.
    plan = []
    for service, targets in TARGETS.items():
        metrics = []
        query = {"view": "FULL", "pageSize": 200}
        while True:
            data = request(
                f"projects/{project_number}/services/{service}/consumerQuotaMetrics",
                query=query,
            )
            metrics.extend(data.get("metrics", []))
            if not data.get("nextPageToken"):
                break
            query["pageToken"] = data["nextPageToken"]
        for suffix, target in targets.items():
            metric_name = service + "/" + suffix
            matching = [limit for metric in metrics
                        if metric.get("metric") == metric_name
                        for limit in metric.get("consumerQuotaLimits", [])
                        if limit.get("unit") == "1/d/{project}"]
            if len(matching) != 1:
                raise RuntimeError(f"Expected one daily limit for {metric_name}")
            limit = matching[0]
            buckets = [b for b in limit.get("quotaBuckets", []) if not b.get("dimensions")]
            if len(buckets) != 1:
                raise RuntimeError(f"Expected one project bucket for {metric_name}")
            bucket = buckets[0]
            current = int(bucket["effectiveLimit"])
            if 0 <= current < target:
                raise RuntimeError(f"Refusing to raise existing stricter limit for {metric_name}: {current}")
            plan.append((limit, bucket, target))
            print(json.dumps({"project": args.project, "metric": metric_name,
                              "current": current, "target": target}), flush=True)

    if not args.apply:
        return
    for limit, bucket, target in plan:
        if int(bucket["effectiveLimit"]) == target:
            continue
        override = bucket.get("consumerOverride")
        path = (override["name"] if override else limit["name"] + "/consumerOverrides")
        checks = ["LIMIT_DECREASE_PERCENTAGE_TOO_HIGH"]
        if args.allow_below_usage:
            checks.append("LIMIT_DECREASE_BELOW_USAGE")
        query = {"forceOnly": checks}
        if override:
            query["updateMask"] = "overrideValue"
        # Only waive the below-usage check when explicitly requested. This may
        # suspend API requests until the daily counter resets.
        operation = request(path, method="PATCH" if override else "POST",
                            body={"overrideValue": str(target)}, query=query)
        for _ in range(30):
            if operation.get("done"):
                break
            time.sleep(2)
            operation = request(operation["name"])
        if not operation.get("done") or operation.get("error"):
            raise RuntimeError(f"Quota update did not finish successfully: {operation}")
        updated = request(limit["name"], query={"view": "FULL"})
        verified = [b for b in updated.get("quotaBuckets", []) if not b.get("dimensions")]
        if len(verified) != 1 or int(verified[0]["effectiveLimit"]) != target:
            raise RuntimeError(f"Effective quota verification failed: {limit['metric']}")
        print(json.dumps({"metric": limit["metric"], "effective_daily_limit": target,
                          "verified": True}), flush=True)


if __name__ == "__main__":
    main()

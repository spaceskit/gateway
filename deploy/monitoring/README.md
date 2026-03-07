# Spaceskit Monitoring Bundle

This directory contains concrete Prometheus, Alertmanager, and Grafana assets for relay/sandbox observability.

## Files

1. `prometheus/prometheus.yml`
2. `prometheus/alerts/spaceskit-alerts.yml`
3. `alertmanager/alertmanager.yml`
4. `grafana/provisioning/datasources/prometheus.yml`
5. `grafana/provisioning/dashboards/dashboards.yml`
6. `grafana/dashboards/spaceskit-relay-sandbox.json`

## Local Usage

1. Start stack from `gateway/deploy`:
   - `docker compose up -d`
2. Prometheus:
   - `http://localhost:9090`
3. Alertmanager:
   - `http://localhost:9093`
4. Local webhook sink for alert delivery verification:
   - `http://localhost:18080`
5. Grafana:
   - `http://localhost:3000` (`admin/admin` in local compose)

## Notes

1. The gateway external profile requires authenticated principal identity for `/metrics`.
2. The provided Prometheus scrape job uses a bearer credential (`prometheus-observer`) to satisfy this requirement.
3. Alerting is routed to Alertmanager, which forwards to the local `alert-webhook` service in this bundle.
4. Production rollouts should replace default Grafana credentials and point Alertmanager receivers at real on-call destinations.

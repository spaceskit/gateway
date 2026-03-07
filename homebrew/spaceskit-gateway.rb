# Homebrew formula for Spaceskit Gateway
#
# Install:
#   brew tap spaceskit/tap
#   brew install spaceskit-gateway
#
# Or directly:
#   brew install spaceskit/tap/spaceskit-gateway

class SpaceskitGateway < Formula
  desc "Multi-agent coordination gateway with Noise Protocol encryption"
  homepage "https://github.com/spaceskit/gateway"
  license "MIT"
  version "0.1.0"

  # TODO: Update URL to point to actual release tarball
  url "https://github.com/spaceskit/gateway/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "PLACEHOLDER_SHA256"

  depends_on "oven-sh/bun/bun"

  def install
    # Install the gateway packages
    system "bun", "install", "--frozen-lockfile"

    # Copy the full source tree (Bun runs TypeScript directly)
    libexec.install Dir["*"]

    # Create a wrapper script that runs the CLI via Bun
    (bin/"spaceskit-gateway").write <<~EOS
      #!/usr/bin/env bash
      exec "#{Formula["bun"].opt_bin}/bun" run "#{libexec}/packages/installer/bin/cli.ts" "$@"
    EOS
  end

  def post_install
    # Create the spaceskit home directory
    (var/"spaceskit").mkpath
    (var/"spaceskit/logs").mkpath
  end

  def caveats
    <<~EOS
      Spaceskit Gateway has been installed.

      To get started:
        spaceskit-gateway init      # Run the setup wizard
        spaceskit-gateway start     # Start the gateway

      To install as a background service:
        spaceskit-gateway service install
        spaceskit-gateway service start

      Configuration: ~/.spaceskit/gateway.json
      Database:      ~/.spaceskit/gateway.db
      Logs:          ~/.spaceskit/logs/
    EOS
  end

  service do
    run [opt_bin/"spaceskit-gateway", "start"]
    keep_alive true
    working_dir var/"spaceskit"
    log_path var/"spaceskit/logs/gateway.log"
    error_log_path var/"spaceskit/logs/gateway.err.log"
  end

  test do
    assert_match "spaceskit-gateway v#{version}", shell_output("#{bin}/spaceskit-gateway version")
  end
end

// @effect-diagnostics nodeBuiltinImport:off - Runs the real installer against a local release fixture.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("installer checksum", () => {
  it.each(
    ["sha256sum", "shasum"].flatMap((checksumTool) =>
      ["home\\data", "home\ndata"].flatMap((homeName) =>
        [true, false].map((validChecksum) => ({ checksumTool, homeName, validChecksum })),
      ),
    ),
  )(
    "verifies with $checksumTool, home $homeName and valid checksum $validChecksum",
    async ({ checksumTool, homeName, validChecksum }) => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-install-progress-"));
      const tools = NodePath.join(root, "tools");
      await NodeFSP.mkdir(tools);
      for (const command of [
        "sh",
        "uname",
        "tar",
        "gzip",
        "cut",
        "curl",
        "grep",
        "mkdir",
        "mktemp",
        "rm",
        "mv",
        "ln",
        checksumTool,
      ]) {
        const executable = NodeChildProcess.execFileSync(
          "sh",
          ["-c", 'command -v "$1"', "sh", command],
          { encoding: "utf8" },
        ).trim();
        await NodeFSP.symlink(executable, NodePath.join(tools, command));
      }
      const t3Home = NodePath.join(root, homeName);
      const version = "1.2.3";
      const stem = `t3-${version}-linux-${HostProcess.Architecture.defaultValue()}`;
      const archiveName = `${stem}.tar.gz`;
      let output = "";
      await NodeFSP.mkdir(NodePath.join(root, stem));
      await NodeFSP.writeFile(NodePath.join(root, stem, "t3"), "#!/bin/sh\necho 't3 v1.2.3'\n", {
        mode: 0o755,
      });
      await NodeFSP.writeFile(
        NodePath.join(root, stem, "payload"),
        NodeCrypto.randomBytes(64 * 1024),
      );
      NodeChildProcess.execFileSync("tar", [
        "-czf",
        NodePath.join(root, archiveName),
        "-C",
        root,
        stem,
      ]);
      const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
      const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
      const server = NodeHttp.createServer((request, response) => {
        if (request.url?.endsWith("/SHA256SUMS")) {
          response.end(`${validChecksum ? checksum : "0".repeat(64)}  ${archiveName}\n`);
        } else {
          response.end(archive);
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const child = NodeChildProcess.spawn(
        "sh",
        [NodePath.resolve(import.meta.dirname, "install.sh")],
        {
          env: {
            ...process.env,
            PATH: tools,
            TERM: "xterm",
            NO_COLOR: "1",
            T3CODE_VERSION: version,
            T3CODE_HOME: t3Home,
            T3CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
            T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        const versions = NodePath.join(t3Home, "runtime/versions");
        if (!validChecksum) {
          expect(code).not.toBe(0);
          expect(output).toContain("checksum mismatch");
          expect(output).not.toContain("Installed T3 Code");
          expect(await NodeFSP.readdir(versions)).toEqual([]);
        } else {
          expect(code, output).toBe(0);
          expect(output).toContain("Installed T3 Code 1.2.3");
          expect(
            await NodeFSP.readFile(NodePath.join(versions, version, ".install-complete"), "utf8"),
          ).toBe("1.2.3\n");
          expect(
            NodeChildProcess.execFileSync(NodePath.join(root, "bin/t3"), ["--version"], {
              encoding: "utf8",
            }).trim(),
          ).toBe("t3 v1.2.3");
          expect(await NodeFSP.readdir(versions)).toEqual([version]);
          expect(await NodeFSP.readFile(NodePath.join(t3Home, "runtime/launchers"), "utf8")).toBe(
            `${NodePath.join(root, "bin/t3")}\n`,
          );
        }
      } finally {
        if (child.exitCode === null) child.kill();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    },
  );
});
